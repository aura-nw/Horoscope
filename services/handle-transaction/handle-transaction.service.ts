/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
'use strict';
import { Config } from '../../common';
import { Service, ServiceBroker } from 'moleculer';
const QueueService = require('moleculer-bull');
import RedisMixin from '../../mixins/redis/redis.mixin';
import { dbTransactionMixin } from '../../mixins/dbMixinMongoose';
import { Job } from 'bull';
import { JsonConvert, OperationMode } from 'json2typescript';
import { IAttribute, IEvent, ITransaction, TransactionEntity } from '../../entities';
import { CONST_CHAR, MSG_TYPE } from '../../common/constant';
import {
	IRedisStreamData,
	IRedisStreamResponse,
	ListTxCreatedParams,
	TransactionHashParam,
} from '../../types';
import { fromBase64, fromUtf8, fromBech32 } from '@cosmjs/encoding';
import { QueueConfig } from '../../config/queue';
import { Utils } from '../../utils/utils';

export default class HandleTransactionService extends Service {
	private redisMixin = new RedisMixin().start();
	private dbTransactionMixin = dbTransactionMixin;
	private consumer = this.broker.nodeID;

	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: 'handletransaction',
			version: 1,
			mixins: [
				QueueService(QueueConfig.redis, QueueConfig.opts),
				this.redisMixin,
				this.dbTransactionMixin,
			],
			queues: {
				'handle.transaction': {
					concurrency: 1,
					async process(job: Job) {
						job.progress(10);
						// @ts-ignore
						await this.handleJob();
						job.progress(100);
						return true;
					},
				},
			},
		});
	}

	async initEnv() {
		this.logger.info('initEnv');
		this.redisClient = await this.getRedisClient();
		try {
			await this.redisClient.xGroupCreate(
				Config.REDIS_STREAM_TRANSACTION_NAME,
				Config.REDIS_STREAM_TRANSACTION_GROUP,
				'0-0',
				{ MKSTREAM: true },
			);
			await this.redisClient.xGroupCreateConsumer(
				Config.REDIS_STREAM_TRANSACTION_NAME,
				Config.REDIS_STREAM_TRANSACTION_GROUP,
				this.consumer,
			);
		} catch (error) {
			this.logger.error(error);
		}
	}
	private hasRemainingMessage = true;
	private lastId = '0-0';
	async handleJob() {
		let xAutoClaimResult: IRedisStreamResponse = await this.redisClient.xAutoClaim(
			Config.REDIS_STREAM_TRANSACTION_NAME,
			Config.REDIS_STREAM_TRANSACTION_GROUP,
			this.consumer,
			Config.REDIS_MIN_IDLE_TIME_HANDLE_TRANSACTION,
			'0-0',
			{ COUNT: Config.REDIS_AUTO_CLAIM_COUNT_HANDLE_TRANSACTION },
		);
		if (xAutoClaimResult.messages.length == 0) {
			this.hasRemainingMessage = false;
		}

		let idXReadGroup = '';
		if (this.hasRemainingMessage) {
			idXReadGroup = this.lastId;
		} else {
			idXReadGroup = '>';
		}
		const result: IRedisStreamResponse[] = await this.redisClient.xReadGroup(
			Config.REDIS_STREAM_TRANSACTION_GROUP,
			this.consumer,
			[{ key: Config.REDIS_STREAM_TRANSACTION_NAME, id: idXReadGroup }],
		);

		if (result)
			result.forEach(async (element: IRedisStreamResponse) => {
				let listTransactionNeedSaveToDb: ITransaction[] = [];
				let listMessageNeedAck: String[] = [];
				try {
					element.messages.forEach(async (item: IRedisStreamData) => {
						this.logger.info(
							`Handling message ID: ${item.id}, txhash: ${item.message.source}`,
						);
						try {
							let txItem = JSON.parse(item.message.element.toString());

							let parsedTxItem = {
								tx: {
									body: {
										messages: txItem.tx.value.msg,
									},
									auth_info: {
										signer_infos: [
											...txItem.tx.value.signatures.map((i: any) => {
												return {
													public_key: {
														'@type': i.pub_key.type,
														key: i.pub_key.value,
													},
												};
											}),
										],
										fee: {
											amount: txItem.tx.value.fee.amount,
											gas_limit: txItem.tx.value.fee.gas,
										},
									},
									signatures: [
										...txItem.tx.value.signatures.map((i: any) => {
											return i.signature;
										}),
									],
								},
								tx_response: {
									height: txItem.height,
									txhash: txItem.txhash,
									raw_log: txItem.raw_log,
									gas_used: txItem.gas_used,
									gas_wanted: txItem.gas_wanted,
									logs: txItem.logs,
									tx: {
										body: {
											messages: txItem.tx.value.msg,
										},
									},
									timestamp: txItem.timestamp,
									events: txItem.events,
								},
							};
							const transaction: TransactionEntity =
								new JsonConvert().deserializeObject(
									parsedTxItem,
									TransactionEntity,
								);
							listTransactionNeedSaveToDb.push(transaction);
							listMessageNeedAck.push(item.id);
							this.lastId = item.id.toString();
						} catch (error) {
							this.logger.error('Error when handling message id: ' + item.id);
							this.logger.error(JSON.stringify(item));
							if (item.message.source) {
								this.broker.emit('crawl-transaction-hash.retry', {
									txHash: item.message.source,
								} as TransactionHashParam);
								listMessageNeedAck.push(item.id);
							}
							this.logger.error(error);
						}
					});

					this.broker.emit('list-tx.upsert', {
						listTx: listTransactionNeedSaveToDb,
						source: CONST_CHAR.CRAWL,
						chainId: Config.CHAIN_ID,
					} as ListTxCreatedParams);

					await this.handleListTransaction(listTransactionNeedSaveToDb);
					if (listMessageNeedAck.length > 0) {
						this.redisClient.xAck(
							Config.REDIS_STREAM_TRANSACTION_NAME,
							Config.REDIS_STREAM_TRANSACTION_GROUP,
							listMessageNeedAck,
						);
						this.redisClient.xDel(
							Config.REDIS_STREAM_TRANSACTION_NAME,
							listMessageNeedAck,
						);
					}
				} catch (error) {
					this.logger.error(error);
				}
			});
	}

	async handleListTransaction(listTransaction: ITransaction[]) {
		let jsonConvert = new JsonConvert();
		try {
			// jsonConvert.operationMode = OperationMode.LOGGING;
			const listTransactionEntity: any = jsonConvert.deserializeArray(
				listTransaction,
				TransactionEntity,
			);
			let listHash = listTransaction.map((item: ITransaction) => {
				return item.tx_response.txhash;
			});
			let listFoundTransaction: ITransaction[] = await this.adapter.find({
				query: {
					'tx_response.txhash': {
						$in: listHash,
					},
				},
			});
			let listTransactionNeedSaveToDb: ITransaction[] = [];

			// add indexes to transaction
			listTransactionEntity.forEach((tx: ITransaction) => {
				let indexes: any = {};
				let listContractInMessages: string[] = [];
				let listAddress: string[] = [];

				// add index in case smart contract
				const listMsg = tx.tx.body.messages;
				try {
					listMsg.map((msg: any) => {
						if (msg['@type'] && msg['@type'] == MSG_TYPE.MSG_EXECUTE_CONTRACT) {
							this.addToIndexes(indexes, 'message', 'action', msg['@type']);
							if (msg.sender && msg.sender.length <= 100) {
								// found attribute in index, if yes then add new
								this.addToIndexes(indexes, 'wasm', 'sender', msg.sender);
							}
							if (msg.contract && msg.contract.length <= 200) {
								this.addToIndexes(
									indexes,
									'wasm',
									'_contract_address',
									msg.contract,
								);
								this.addToIndexes(
									indexes,
									'execute',
									'_contract_address',
									msg.contract,
								);
							}
							if (msg.msg) {
								let msgInput = msg.msg;
								let self = this;
								Object.keys(msgInput).map(function (key) {
									self.addToIndexes(indexes, 'wasm', 'action', key);
									['recipient', 'owner', 'token_id'].map((att: string) => {
										if (
											msgInput[key][att] &&
											msgInput[key][att].length <= 200
										) {
											self.addToIndexes(
												indexes,
												'wasm',
												att,
												msgInput[key][att],
											);
											const isValidAddress = Utils.isValidAddress(
												msgInput[key][att],
											);
											if (isValidAddress) {
												self.addToIndexes(
													indexes,
													'addresses',
													'',
													msgInput[key][att],
												);
											}
										}
									});
								});
							}
						}
					});
				} catch (error) {
					this.logger.error('This message execute contract is error');
					this.logger.error(error);
				}

				//@ts-ignore
				indexes['timestamp'] = new Date(tx.tx_response.timestamp);
				indexes['height'] = Number(tx.tx_response.height);

				tx?.tx_response?.events?.map((event: IEvent) => {
					let type = event.type.toString();
					type = type.replace(/\./g, '_');
					let attributes = event.attributes;
					attributes.map((attribute: IAttribute) => {
						try {
							let key = attribute.key.toString();
							let value = attribute.value ? attribute.value.toString() : '';
							key = key.replace(/\./g, '_');
							this.addToIndexes(indexes, type, key, value);

							//add to listAddress if value is valid address
							const isValidAddress = Utils.isValidAddress(value);
							if (isValidAddress) {
								// listAddress.push(value);
								this.addToIndexes(indexes, 'addresses', '', value);
							}

							let hashValue = this.redisClient
								.hGet(`att-${type}`, key)
								.then((value: any) => {
									if (value) {
										this.redisClient.hSet(
											`att-${type}`,
											key,
											Number(value) + 1,
										);
									} else {
										this.redisClient.hSet(`att-${type}`, key, 1);
									}
								});
						} catch (error) {
							this.logger.info(tx._id);
							this.logger.error(error);
						}
					});
				});

				//remove duplicate and set index
				// listAddress = [...new Set(listAddress)];
				// if (listAddress && listAddress.length > 0) {
				// 	indexes['addresses'] = listAddress;
				// }

				tx.indexes = indexes;

				let hash = tx.tx_response.txhash;
				let foundItem = listFoundTransaction.find((itemFound: ITransaction) => {
					return itemFound.tx_response.txhash == hash;
				});

				if (!foundItem) {
					listTransactionNeedSaveToDb.push(tx);
				}
			});
			let listId = await this.adapter.insertMany(listTransactionNeedSaveToDb);
			return listId;
		} catch (error) {
			throw error;
		}
	}

	private addToIndexes(indexes: any, type: string, key: string, value: string) {
		let index = `${type}`;
		if (key) {
			index = `${type}_${key}`;
		}
		let array = indexes[index];
		if (array && array.length > 0) {
			let position = indexes[index].indexOf(value);
			if (position == -1) {
				indexes[index].push(value);
			}
		} else {
			indexes[index] = [value];
		}
	}

	async _start() {
		this.redisClient = await this.getRedisClient();
		await this.initEnv();
		this.createJob(
			'handle.transaction',
			{},
			{
				removeOnComplete: true,
				removeOnFail: {
					count: 3,
				},
				repeat: {
					every: parseInt(Config.MILISECOND_HANDLE_TRANSACTION, 10),
				},
			},
		);
		this.getQueue('handle.transaction').on('completed', (job: Job) => {
			this.logger.info(`Job #${job.id} completed!, result: ${job.returnvalue}`);
		});
		this.getQueue('handle.transaction').on('failed', (job: Job) => {
			this.logger.error(`Job #${job.id} failed!, error: ${job.failedReason}`);
		});
		this.getQueue('handle.transaction').on('progress', (job: Job) => {
			this.logger.info(`Job #${job.id} progress: ${job.progress()}%`);
		});
		return super._start();
	}
}
