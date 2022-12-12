/* eslint-disable camelcase */
import { Job } from 'bull';
import { JsonConvert } from 'json2typescript';
import { Context, Service, ServiceBroker } from 'moleculer';
import { fromBech32 } from '@cosmjs/encoding';
import CallApiMixin from '../../mixins/callApi/call-api.mixin';
import { dbAccountInfoMixin } from '../../mixins/dbMixinMongoose';
import { Config } from '../../common';
import { DELAY_JOB_TYPE, LIST_NETWORK, URL_TYPE_CONSTANTS } from '../../common/constant';
import { UnbondingResponse, DelayJobEntity, AccountInfoEntity } from '../../entities';
import { Utils } from '../../utils/utils';
import { CrawlAccountInfoParams } from '../../types';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { queueConfig } from '../../config/queue';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const queueService = require('moleculer-bull');

export default class CrawlAccountUnbondsService extends Service {
	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: 'crawlAccountUnbonds',
			version: 1,
			mixins: [
				queueService(queueConfig.redis, queueConfig.opts),
				dbAccountInfoMixin,
				new CallApiMixin().start(),
			],
			queues: {
				'crawl.account-unbonds': {
					concurrency: parseInt(Config.CONCURRENCY_ACCOUNT_UNBONDS, 10),
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
				'account-info.upsert-unbonds': {
					handler: (ctx: Context<CrawlAccountInfoParams>) => {
						this.logger.debug('Crawl account unbonds');
						this.createJob(
							'crawl.account-unbonds',
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

	public async handleJob(listAddresses: string[], chainId: string) {
		const listAccounts: AccountInfoEntity[] = [];
		let listUpdateQueries: any[] = [];
		const listDelayJobs: DelayJobEntity[] = [];
		chainId = chainId !== '' ? chainId : Config.CHAIN_ID;
		const chain = LIST_NETWORK.find((x) => x.chainId === chainId);
		listAddresses = listAddresses.filter((addr: string) => fromBech32(addr).data.length === 20);
		if (listAddresses.length > 0) {
			for (const address of listAddresses) {
				this.logger.info(`Handle address: ${address}`);

				const listUnbonds: UnbondingResponse[] = [];

				const param =
					Config.GET_PARAMS_DELEGATOR +
					`/${address}/unbonding_delegations?pagination.limit=100`;
				const url = Utils.getUrlByChainIdAndType(chainId, URL_TYPE_CONSTANTS.LCD);
				const network = LIST_NETWORK.find((x) => x.chainId === chainId);
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

					if (resultCallApi.unbonding_responses.length > 0) {
						listUnbonds.push(...resultCallApi.unbonding_responses);
					}
					if (resultCallApi.pagination.next_key === null) {
						done = true;
					} else {
						urlToCall = `${param}&pagination.key=${encodeURIComponent(
							resultCallApi.pagination.next_key,
						)}`;
					}
				}

				if (listUnbonds) {
					accountInfo.account_unbonding = listUnbonds;
					listUnbonds.map((unbond: UnbondingResponse) => {
						const newDelayJob = {} as DelayJobEntity;
						newDelayJob.content = { address };
						newDelayJob.type = DELAY_JOB_TYPE.UNBOND;
						newDelayJob.expire_time = new Date(unbond.entries[0].completion_time!);
						newDelayJob.indexes = `${address}${
							newDelayJob.type
						}${newDelayJob?.expire_time.getTime()}${chainId}`;

						newDelayJob.custom_info = {
							chain_id: chainId,
							chain_name: chain ? chain.chainName : '',
						};
						listDelayJobs.push(newDelayJob);
					});
				}

				listAccounts.push(accountInfo);
			}
		}
		try {
			const network = LIST_NETWORK.find((x) => x.chainId === chainId);
			if (network && network.databaseName) {
				this.adapter.useDb(network.databaseName);
			}
			listAccounts.forEach((element) => {
				// eslint-disable-next-line no-underscore-dangle
				if (element._id) {
					listUpdateQueries.push(
						// eslint-disable-next-line no-underscore-dangle
						this.adapter.updateById(element._id, {
							$set: { account_unbonding: element.account_unbonding },
						}),
					);
				} else {
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
		try {
			listUpdateQueries = [];
			listDelayJobs.map((element) => {
				listUpdateQueries.push(this.broker.call('v1.delay-job.addNewJob', element));
			});
			await Promise.all(listUpdateQueries);
		} catch (error) {
			this.logger.error(error);
		}
	}

	public async _start() {
		this.getQueue('crawl.account-unbonds').on('completed', (job: Job) => {
			this.logger.info(`Job #${job.id} completed!. Result:`, job.returnvalue);
		});
		this.getQueue('crawl.account-unbonds').on('failed', (job: Job) => {
			this.logger.error(`Job #${job.id} failed!. Result:`, job.failedReason);
		});
		this.getQueue('crawl.account-unbonds').on('progress', (job: Job) => {
			this.logger.info(`Job #${job.id} progress is ${job.progress()}%`);
		});
		// eslint-disable-next-line no-underscore-dangle
		return super._start();
	}
}
