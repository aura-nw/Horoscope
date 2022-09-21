/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
'use strict';

import CallApiMixin from '../../mixins/callApi/call-api.mixin';
import { dbCW721MediaLinkMixin } from '../../mixins/dbMixinMongoose';
// import { lockCacherMixin } from '../../mixins/lockCacher/lock.mixin';
import moleculer, { CallingOptions, Context, ServiceBroker } from 'moleculer';
import { Service } from '@ourparentcenter/moleculer-decorators-extended';
import { MediaStatus } from '../../model/cw721-asset-media.model';
import { Config } from '../../common';
import { Types } from 'mongoose';
import { CONTRACT_TYPE, CW721_MEDIA_MANAGER_ACTION } from '../../common/constant';
import { QueryOptions } from 'moleculer-db';
// import { RedisClientType, commandOptions } from '@redis/client';
var util = require('util');

const callApiMixin = new CallApiMixin().start();
const ACTION_TIMEOUT = Config.ASSET_INDEXER_ACTION_TIMEOUT;
const MAX_RETRY_REQ = Config.ASSET_INDEXER_MAX_RETRY_REQ;
const CACHER_INDEXER_TTL = parseInt(Config.CACHER_INDEXER_TTL);
const OPTs: CallingOptions = { timeout: 10000, retries: MAX_RETRY_REQ };

const GET_MEDIA_LINK_PREFIX = 'get_media_link';

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */
@Service({
	name: 'CW721-media',
	version: 1,
	mixins: [callApiMixin, dbCW721MediaLinkMixin],
	events: {
		'CW721-media.get-media-link': {
			async handler(ctx: Context<any>) {
				const uri = ctx.params.uri;
				const file_name = ctx.params.file_name;
				const media_link_key = ctx.params.media_link_key;
				const hostname = ctx.params.hostname;
				const path = ctx.params.path;
				const cacheKey = `${GET_MEDIA_LINK_PREFIX}_${media_link_key}`;
				// @ts-ignore
				// this.logger.info("this.broker.cacher",util.inspect(this.broker.cacher));
				// @ts-ignore
				this.logger.debug(
					'get-media-link ctx.params',
					uri,
					media_link_key,
					CONTRACT_TYPE.CW721,
				);

				// @ts-ignore
				const processingFlag = (await this.broker.cacher?.get(cacheKey)) ? true : false;

				if (!processingFlag) {
					try {
						// @ts-ignore
						// let locked = await this.broker.cacher?.tryLock(cacheKey, 15000);
						// @ts-ignore
						try {
							// @ts-ignore
							this.getMediaLink(uri, file_name, media_link_key, hostname, path);
						} catch (error) {
							// @ts-ignore
							this.logger.error('getMediaLink error', media_link_key, error);
						}
						// @ts-ignore
						// await this.broker.cacher?.del(cacheKey);
						// @ts-ignore
						// await locked();
						// @ts-ignore
						this.logger.info('getMediaLink locked', media_link_key);
						// await this.unlock(cacheKey);
						// }
					} catch (e) {
						// @ts-ignore
						this.logger.error('tryLock error', cacheKey);
					}
				}
			},
		},
	},
})
export default class CrawlAssetService extends moleculer.Service {
	async getMediaLink(
		uri: string,
		file_name: string,
		key: string,
		hostname: string,
		path: string,
	) {
		this.logger.info('getMediaLink', uri, file_name, key);
		let query: QueryOptions = { key };
		const media: any[] = await this.broker.call(
			CW721_MEDIA_MANAGER_ACTION.FIND,
			{ query },
			OPTs,
		);
		this.logger.debug('media', media);

		if (media.length === 0) {
			await this.broker.call(
				CW721_MEDIA_MANAGER_ACTION.INSERT,
				{
					_id: new Types.ObjectId(),
					key,
					media_link: '',
					status: MediaStatus.HANDLING,
				},
				OPTs,
			);
			await this.broker.call(
				CW721_MEDIA_MANAGER_ACTION.UPDATE_MEDIA_LINK,
				{ uri, file_name, key, hostname, path },
				OPTs,
			);
		} else {
			switch (media[0].status) {
				case MediaStatus.PENDING: {
					await this.broker.call(
						CW721_MEDIA_MANAGER_ACTION.UPDATE_MEDIA_LINK,
						{ uri, file_name, key },
						OPTs,
					);
					break;
				}
				case MediaStatus.COMPLETED:
					// do nothing
					break;
				case MediaStatus.HANDLING:
					// do nothing
					break;
				case MediaStatus.ERROR:
					// do nothing
					break;
			}
		}
	}
}
export class CW721AssetMedia {}
