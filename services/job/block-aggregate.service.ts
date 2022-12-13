/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
'use strict';
import { Service, ServiceBroker } from 'moleculer';
import { Job } from 'bull';
import { IBlock } from 'entities';
import { dbBlockAggregateMixin } from '../../mixins/dbMixinMongoose';
import { queueConfig } from '../../config/queue';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const queueService = require('moleculer-bull');

export default class BlockAggregateService extends Service {
	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: 'blockAggregate',
			version: 1,
			mixins: [queueService(queueConfig.redis, queueConfig.opts), dbBlockAggregateMixin],
			queues: {
				'listblock.insert': {
					concurrency: 10,
					process(job: Job) {
						job.progress(10);
						// @ts-ignore
						this.handleJob(job.data.listBlock);
						job.progress(100);
						return true;
					},
				},
			},
			events: {
				'job.moveblock': {
					handler: (ctx: any) => {
						this.createJob(
							'listblock.insert',
							{
								listBlock: ctx.params.listBlock,
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

	async handleJob(listBlock: IBlock[]) {
		const listBulk: any[] = [];
		if (!listBlock) {
			return;
		}
		listBlock.map(async (block: IBlock) => {
			listBulk.push({
				insertOne: {
					document: block,
				},
			});
		});
		const result = await this.adapter.bulkWrite(listBulk);
		this.logger.info(`Update block: ${listBlock.length}`, result);
	}

	public async _start() {
		this.getQueue('listblock.insert').on('completed', (job: Job) => {
			this.logger.info(`Job #${job.id} completed!, result: ${job.returnvalue}`);
		});
		this.getQueue('listblock.insert').on('failed', (job: Job) => {
			this.logger.error(`Job #${job.id} failed!, error: ${job.failedReason}`);
		});
		this.getQueue('listblock.insert').on('progress', (job: Job) => {
			this.logger.info(`Job #${job.id} progress: ${job.progress()}%`);
		});
		// eslint-disable-next-line no-underscore-dangle
		return super._start();
	}
}
