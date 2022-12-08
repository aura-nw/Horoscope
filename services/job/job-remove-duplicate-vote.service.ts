/* eslint-disable no-underscore-dangle */
/* eslint-disable camelcase */
import { Service, ServiceBroker } from 'moleculer';
import { Job } from 'bull';
import { Config } from '../../common';
import RedisMixin from '../../mixins/redis/redis.mixin';
import { dbVoteMixin } from '../../mixins/dbMixinMongoose/db-vote.mixin';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const queueService = require('moleculer-bull');

export default class RemoveDuplicateVotingData extends Service {
	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: 'remove-duplicate-vote',
			version: 1,
			mixins: [
				queueService(
					`redis://${Config.REDIS_USERNAME}:${Config.REDIS_PASSWORD}@${Config.REDIS_HOST}:${Config.REDIS_PORT}/${Config.REDIS_DB_NUMBER}`,
				),
				dbVoteMixin,
				new RedisMixin().start(),
			],
			queues: {
				'remove.duplicate.vote': {
					concurrency: 1,
					process(job: Job) {
						job.progress(10);

						// @ts-ignore
						this.handleJob(job.data.lastId, job.data.stopPoint);
						job.progress(100);
						return true;
					},
				},
			},
		});
	}

	public async handleJob() {
		for (let i = 0; ; i++) {
			this.logger.info(`Start job ${i}`);
			const vote = await this.adapter.find({
				query: {
					'custom_info.chain_id': 'serenity-testnet-001',
				},
				sort: '_id',
				limit: 1,
				offset: i,
			});
			if (vote.length === 0) {
				break;
			}
			const listVote = await this.adapter.find({
				query: {
					'custom_info.chain_id': vote[0].custom_info.chain_id,
					voter_address: vote[0].voter_address,
					proposal_id: vote[0].proposal_id,
				},
				sort: '-_id',
				limit: 100,
				skip: 0,
			});
			// Keep the first one
			if (listVote.length > 1) {
				for (let j = 1; j < listVote.length; j++) {
					const result = await this.adapter.removeById(listVote[j]._id.toString());
					this.logger.info(`Remove duplicate vote: ${result}`);
				}
			}
		}
		this.logger.info('Remove duplicate vote done');
		return;
	}

	public async _start() {
		this.createJob(
			'remove.duplicate.vote',
			{},
			{
				removeOnComplete: true,
			},
		);
		this.getQueue('index.tx').on('completed', (job: Job) => {
			this.logger.info(`Job #${job.id} completed!, result: ${job.returnvalue}`);
		});
		this.getQueue('index.tx').on('failed', (job: Job) => {
			this.logger.error(`Job #${job.id} failed!, error: ${job.failedReason}`);
		});
		this.getQueue('index.tx').on('progress', (job: Job) => {
			this.logger.info(`Job #${job.id} progress: ${job.progress()}%`);
		});
		// eslint-disable-next-line no-underscore-dangle
		return super._start();
	}
}
