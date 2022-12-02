import CallApiMixin from '../../mixins/callApi/call-api.mixin';
import { dbAccountInfoMixin } from '../../mixins/dbMixinMongoose';
import { Job } from 'bull';
import { Config } from '../../common';
import { LIST_NETWORK, URL_TYPE_CONSTANTS } from '../../common/constant';
import { JsonConvert } from 'json2typescript';
import { Context, Service, ServiceBroker } from 'moleculer';
import { Utils } from '../../utils/utils';
import { CrawlAccountInfoParams } from '../../types';
import { AccountInfoEntity, IBCDenomEntity } from '../../entities';
import { fromBech32 } from '@cosmjs/encoding';
import { QueueConfig } from '../../config/queue';
const QueueService = require('moleculer-bull');

export default class CrawlAccountBalancesService extends Service {
	private callApiMixin = new CallApiMixin().start();
	private dbAccountInfoMixin = dbAccountInfoMixin;

	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: 'crawlAccountBalances',
			version: 1,
			mixins: [
				QueueService(QueueConfig.redis, QueueConfig.opts),
				// this.redisMixin,
				this.dbAccountInfoMixin,
				this.callApiMixin,
			],
			queues: {
				'crawl.account-balances': {
					concurrency: parseInt(Config.CONCURRENCY_ACCOUNT_BALANCES, 10),
					async process(job: Job) {
						job.progress(10);
						// @ts-ignore
						await this.handleJob(job.data.listAddresses, job.data.chainId);
						job.progress(100);
						return true;
					},
				},
			},
			events: {
				'account-info.upsert-balances': {
					handler: (ctx: Context<CrawlAccountInfoParams>) => {
						this.logger.debug(`Crawl account balances`);
						this.createJob(
							'crawl.account-balances',
							{
								listAddresses: ctx.params.listAddresses,
								chainId: ctx.params.chainId,
							},
							{
								removeOnComplete: true,
								removeOnFail: {
									count: 10,
								},
							},
						);
						return;
					},
				},
			},
		});
	}

	async handleJob(listAddresses: string[], chainId: string) {
		let listAccounts: AccountInfoEntity[] = [],
			listUpdateQueries: any[] = [];
		chainId = chainId !== '' ? chainId : Config.CHAIN_ID;
		const chain = LIST_NETWORK.find((x) => x.chainId === chainId);
		listAddresses = listAddresses.filter(
			(addr: string) => fromBech32(addr).data.length === 20
		);
		if (listAddresses.length > 0) {
			for (let address of listAddresses) {
				this.logger.info(`Handle address: ${address}`);

				let listBalances: any[] = [];

				const param = Config.GET_PARAMS_BALANCE + `/${address}?pagination.limit=100`;
				const url = Utils.getUrlByChainIdAndType(chainId, URL_TYPE_CONSTANTS.LCD);
				const network = LIST_NETWORK.find((x) => x.chainId == chainId);
				if (network && network.databaseName) {
					this.adapter.useDb(network.databaseName);
				}
				let accountInfo: AccountInfoEntity;
				try {
					accountInfo = await this.adapter.findOne({
						address,
					});
				} catch (error) {
					this.logger.error(error);
					throw error;
				}
				if (!accountInfo) {
					accountInfo = {} as AccountInfoEntity;
					accountInfo.address = address;
				}

				let urlToCall = param;
				let done = false;
				let resultCallApi;
				while (!done) {
					try {
						resultCallApi = await this.callApiFromDomain(url, urlToCall);
					} catch (error) {
						this.logger.error(error);
						throw error;
					}

					if (resultCallApi.balances.length > 0)
						listBalances.push(...resultCallApi.balances);
					if (resultCallApi.pagination.next_key === null) {
						done = true;
					} else {
						urlToCall = `${param}&pagination.key=${encodeURIComponent(
							resultCallApi.pagination.next_key,
						)}`;
					}
				}

				if (listBalances) {
					if (listBalances.length > 1) {
						await Promise.all(
							listBalances.map(async (balance) => {
								if (balance.denom.startsWith('ibc/')) {
									let hash = balance.denom.split('/')[1];
									let ibcDenom: IBCDenomEntity;
									try {
										ibcDenom = await this.broker.call(
											'v1.ibc-denom.getByHash',
											{ hash: balance.denom, denom: '' },
										);
									} catch (error) {
										this.logger.error(error);
										throw error;
									}
									if (ibcDenom) {
										balance.denom = ibcDenom.denom;
										balance.minimal_denom = ibcDenom.hash;
									} else {
										const hashParam = Config.GET_PARAMS_IBC_DENOM + `/${hash}`;
										let denomResult;
										try {
											denomResult = await this.callApiFromDomain(
												url,
												hashParam,
											);
										} catch (error) {
											this.logger.error(error);
											throw error;
										}
										balance.minimal_denom = balance.denom;
										balance.denom = denomResult.denom_trace.base_denom;
										try {
											this.broker.call('v1.ibc-denom.addNewDenom', {
												hash: `ibc/${hash}`,
												denom: balance.denom,
											});
										} catch (error) {
											this.logger.error(error);
											throw error;
										}
									}
								}
							}),
						);
					}
					accountInfo.account_balances = listBalances;
				}

				listAccounts.push(accountInfo);
			}
		}
		try {
			const network = LIST_NETWORK.find((x) => x.chainId == chainId);
			if (network && network.databaseName) {
				this.adapter.useDb(network.databaseName);
			}
			listAccounts.map((element) => {
				if (element._id)
					listUpdateQueries.push(
						this.adapter.updateById(element._id, {
							$set: { account_balances: element.account_balances },
						}),
					);
				else {
					const item: AccountInfoEntity = new JsonConvert().deserializeObject(
						element,
						AccountInfoEntity,
					);
					item.custom_info = {
						chain_id: chainId,
						chain_name: chain ? chain.chainName : '',
					};
					listUpdateQueries.push(this.adapter.insert(item));
				}
			});
			await Promise.all(listUpdateQueries);
		} catch (error) {
			this.logger.error(error);
			throw error;
		}
	}

	async _start() {
		this.getQueue('crawl.account-balances').on('completed', (job: Job) => {
			this.logger.info(`Job #${job.id} completed!. Result:`, job.returnvalue);
		});
		this.getQueue('crawl.account-balances').on('failed', (job: Job) => {
			this.logger.error(`Job #${job.id} failed!. Result:`, job.failedReason);
		});
		this.getQueue('crawl.account-balances').on('progress', (job: Job) => {
			this.logger.info(`Job #${job.id} progress is ${job.progress()}%`);
		});
		return super._start();
	}
}
