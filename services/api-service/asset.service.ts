/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
'use strict';
import { Context } from 'moleculer';
import { Service, Get, Post } from '@ourparentcenter/moleculer-decorators-extended';
import { Types } from 'mongoose';
import { QueryOptions } from 'moleculer-db';
import { ObjectId } from 'mongodb';
import {
	ErrorCode,
	ErrorMessage,
	GetAssetByContractTypeAddressRequest,
	GetAssetByOwnerAddressRequest,
	GetHolderRequest,
	MoleculerDBService,
	ResponseDto,
	RestOptions,
} from '../../types';
import { AssetIndexParams } from '../../types/asset';
// Import rateLimit from 'micro-ratelimit';
import { CodeIDStatus } from '../../model/codeid.model';
import {
	CODEID_MANAGER_ACTION,
	CONTRACT_TYPE,
	LIST_NETWORK,
	URL_TYPE_CONSTANTS,
} from '../../common/constant';
import { Utils } from '../../utils/utils';

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */
@Service({
	name: 'asset',
	version: 1,
})
export default class AssetService extends MoleculerDBService<
	{
		rest: 'v1/asset';
	},
	unknown
> {
	@Post<RestOptions>('/index', {
		name: 'index',
		restricted: ['api'],
		params: {
			codeId: ['number|integer|positive'],
			contractType: { type: 'string', optional: false, enum: Object.values(CONTRACT_TYPE) },
			chainId: {
				type: 'string',
				optional: false,
				enum: LIST_NETWORK.map((e) => e.chainId),
			},
		},
	})
	async index(ctx: Context<AssetIndexParams, Record<string, unknown>>) {
		let response: ResponseDto = {} as ResponseDto;
		let registed = false;
		const codeId = ctx.params.codeId;
		const chainId = ctx.params.chainId;
		const contractType = ctx.params.contractType;
		return await this.broker
			.call(CODEID_MANAGER_ACTION.FIND, {
				query: { codeId, 'custom_info.chain_id': chainId },
			})
			.then(async (res: any) => {
				/* eslint-disable camelcase */
				this.logger.info('codeid-manager.find res', res);
				if (res.length > 0) {
					switch (res[0].status) {
						case CodeIDStatus.REJECTED:
							if (res[0].contract_type !== contractType) {
								const condition = {
									// eslint-disable-next-line quote-props
									code_id: codeId,
									'custom_info.chain_id': chainId,
								};
								this.broker.call(CODEID_MANAGER_ACTION.UPDATE_MANY, {
									condition,
									update: {
										status: CodeIDStatus.WAITING,
										contract_type: contractType,
									},
								});
								registed = true;
							}
							break;
						case CodeIDStatus.TBD:
							registed = true;
							break;
						// Case Status.WAITING:
						default:
							break;
					}
				} else {
					this.broker.call(CODEID_MANAGER_ACTION.INSERT, {
						_id: new Types.ObjectId(),
						code_id: codeId,
						status: CodeIDStatus.WAITING,
						contract_type: contractType,
						custom_info: {
							// eslint-disable-next-line quote-props
							chain_id: chainId,
							chain_name: LIST_NETWORK.find((x) => x.chainId === chainId)?.chainName,
						},
					});
					registed = true;
				}
				this.logger.debug('codeid-manager.registed:', registed);
				if (registed) {
					const url = Utils.getUrlByChainIdAndType(chainId, URL_TYPE_CONSTANTS.LCD);
					this.broker.emit(`${contractType}.validate`, { url, chainId, codeId });
				}
				return (response = {
					code: ErrorCode.SUCCESSFUL,
					message: ErrorMessage.SUCCESSFUL,
					data: { registed },
				});
				/* eslint-enable camelcase */
			})
			.catch((error) => {
				this.logger.error('call code_id.checkStatus error', error);
				return (response = {
					code: ErrorCode.WRONG,
					message: ErrorMessage.WRONG,
					data: { error },
				});
			});
	}

	@Get('/getByOwner', {
		name: 'getByOwner',
		params: {
			owner: { type: 'string', optional: true },
			chainid: {
				type: 'string',
				optional: true,
				enum: LIST_NETWORK.map((e) => e.chainId),
			},
			tokenName: { type: 'string', optional: true },
			tokenId: { type: 'string', optional: true },
			contractAddress: { type: 'string', optional: true },
			contractType: {
				type: 'string',
				optional: false,
				enum: Object.values(CONTRACT_TYPE),
				default: 'CW20',
			},
			isBurned: {
				type: 'boolean',
				optional: true,
				convert: true,
			},
			countTotal: {
				type: 'boolean',
				optional: true,
				default: false,
				convert: true,
			},
			pageLimit: {
				type: 'number',
				optional: true,
				default: 10,
				integer: true,
				convert: true,
				min: 1,
				max: 100,
			},
			pageOffset: {
				type: 'number',
				optional: true,
				default: 0,
				integer: true,
				convert: true,
				min: 0,
				max: 100,
			},
			nextKey: {
				type: 'string',
				optional: true,
				default: null,
			},
		},
		cache: {
			ttl: 10,
		},
	})
	async getByOwner(ctx: Context<GetAssetByOwnerAddressRequest, Record<string, unknown>>) {
		let response: ResponseDto = {} as ResponseDto;
		if (!ctx.params.owner && !ctx.params.contractAddress) {
			return (response = {
				code: ErrorCode.WRONG,
				message: ErrorMessage.VALIDATION_ERROR,
				data: {
					message: 'owner or contractAddress must be inputted',
				},
			});
		}
		try {
			const query: QueryOptions = {};
			/* eslint-disable camelcase */
			if (ctx.params.owner) {
				query.owner = ctx.params.owner;
			}
			if (ctx.params.chainid) {
				query['custom_info.chain_id'] = ctx.params.chainid;
			}
			if (ctx.params.tokenId) {
				query.token_id = ctx.params.tokenId;
			}
			if (ctx.params.contractAddress) {
				query.contract_address = ctx.params.contractAddress;
			}
			if (ctx.params.isBurned != null) {
				query.is_burned = ctx.params.isBurned;
			}
			if (ctx.params.tokenName) {
				query.$or = [
					{
						token_id: ctx.params.tokenName,
					},
					{
						'asset_info.data.name': ctx.params.tokenName,
					},
				];
			}
			if (ctx.params.nextKey) {
				ctx.params.pageOffset = 0;
				ctx.params.countTotal = false;
			}
			this.logger.debug('query', query);
			const contractType = ctx.params.contractType;
			let asset: any[];
			if (contractType === CONTRACT_TYPE.CW721 || contractType === CONTRACT_TYPE.CW4973) {
				asset = await this.broker.call(`v1.${contractType}-asset-manager.act-find`, {
					query,
					sort: '-updatedAt',
					limit: ctx.params.pageLimit + 1,
					offset: ctx.params.pageOffset,
					nextKey: ctx.params.nextKey,
				});
			} else {
				asset = await this.broker.call(`v1.${contractType}-asset-manager.act-find`, {
					query,
					sort: '-updatedAt',
					limit: ctx.params.pageLimit + 1,
					offset: ctx.params.pageOffset,
					nextKey: ctx.params.nextKey,
				});
			}
			let nextKey = null;
			if (asset.length > 0) {
				if (asset.length === 1) {
					// eslint-disable-next-line no-underscore-dangle
					nextKey = asset[asset.length - 1]?._id;
				} else {
					// eslint-disable-next-line no-underscore-dangle
					nextKey = asset[asset.length - 2]?._id;
				}
				if (asset.length <= ctx.params.pageLimit) {
					nextKey = null;
				}
				if (nextKey) {
					asset.pop();
				}
			}
			this.logger.debug(`asset: ${JSON.stringify(asset)}`);
			let count = 0;
			if (ctx.params.countTotal === true) {
				count = await this.broker.call(`v1.${contractType}-asset-manager.act-count`, {
					query,
					skip: 0,
					limit: ctx.params.pageLimit * 5,
				});
			}
			const assetsMap: Map<any, any> = new Map();
			assetsMap.set(contractType, { asset, count });

			const assetObj = Object.fromEntries(assetsMap);
			this.logger.debug(`assetObj: ${JSON.stringify(assetObj)}`);

			response = {
				code: ErrorCode.SUCCESSFUL,
				message: ErrorMessage.SUCCESSFUL,
				data: {
					assets: assetObj,
					nextKey,
				},
			};
		} catch (error) {
			response = {
				code: ErrorCode.WRONG,
				message: ErrorMessage.WRONG,
				data: {
					error,
				},
			};
		}
		return response;
	}

	@Get('/getByContractType', {
		name: 'getByContractType',
		params: {
			contractType: { type: 'string', optional: false, enum: Object.values(CONTRACT_TYPE) },
			chainid: {
				type: 'string',
				optional: true,
				enum: LIST_NETWORK.map((e) => e.chainId),
			},
			pageLimit: {
				type: 'number',
				optional: true,
				default: 10,
				integer: true,
				convert: true,
				min: 1,
				max: 100,
			},
			pageOffset: {
				type: 'number',
				optional: true,
				default: 0,
				integer: true,
				convert: true,
				min: 0,
				max: 100,
			},
			countTotal: {
				type: 'boolean',
				optional: true,
				default: false,
				convert: true,
			},
			nextKey: {
				type: 'string',
				optional: true,
				default: null,
			},
		},
		cache: {
			ttl: 10,
		},
	})
	async getByContractType(
		ctx: Context<GetAssetByContractTypeAddressRequest, Record<string, unknown>>,
	) {
		let response: ResponseDto = {} as ResponseDto;
		if (ctx.params.nextKey) {
			try {
				new ObjectId(ctx.params.nextKey);
			} catch (error) {
				return (response = {
					code: ErrorCode.WRONG,
					message: ErrorMessage.VALIDATION_ERROR,
					data: {
						message: 'The nextKey is not a valid ObjectId',
					},
				});
			}
		}
		try {
			const query: QueryOptions = {};
			if (ctx.params.chainid) {
				query['custom_info.chain_id'] = ctx.params.chainid;
			}
			const needNextKey = true;
			if (ctx.params.nextKey) {
				// eslint-disable-next-line no-underscore-dangle
				query._id = { $lt: new ObjectId(ctx.params.nextKey) };
				ctx.params.pageOffset = 0;
				ctx.params.countTotal = false;
			}

			this.logger.info('query', query);

			let assets: any[];
			if (ctx.params.contractType === CONTRACT_TYPE.CW20) {
				assets = await this.broker.call(
					`v1.${ctx.params.contractType}-asset-manager.act-find`,
					{
						query,
						limit: ctx.params.pageLimit,
						offset: ctx.params.pageOffset,
						sort: '-updatedAt',
					},
				);
			} else {
				assets = await this.broker.call(
					`v1.${ctx.params.contractType}-asset-manager.act-find`,
					{
						query,
						limit: ctx.params.pageLimit,
						offset: ctx.params.pageOffset,
						sort: '-updatedAt',
						nextKey: ctx.params.nextKey,
					},
				);
				this.logger.debug(JSON.stringify(assets));
			}
			let count = 0;
			if (ctx.params.countTotal === true) {
				count = await this.broker.call(
					`v1.${ctx.params.contractType}-asset-manager.act-count`,
					{
						query,
					},
				);
			}
			response = {
				code: ErrorCode.SUCCESSFUL,
				message: ErrorMessage.SUCCESSFUL,
				data: {
					assets,
					count,
					// eslint-disable-next-line no-underscore-dangle
					nextKey: needNextKey ? assets[assets.length - 1]?._id : null,
				},
			};
		} catch (error) {
			response = {
				code: ErrorCode.WRONG,
				message: ErrorMessage.WRONG,
				data: {
					error,
				},
			};
		}
		return response;
	}

	@Get('/holder', {
		name: 'holder',
		params: {
			contractType: {
				type: 'string',
				optional: false,
				enum: Object.keys(CONTRACT_TYPE),
				default: null,
			},
			contractAddress: {
				type: 'string',
				optional: false,
				default: null,
			},
			chainid: {
				type: 'string',
				optional: false,
				enum: LIST_NETWORK.map((e) => e.chainId),
			},
			pageLimit: {
				type: 'number',
				optional: true,
				default: 10,
				integer: true,
				convert: true,
				min: 1,
				max: 100,
			},
			pageOffset: {
				type: 'number',
				optional: true,
				default: 0,
				integer: true,
				convert: true,
				min: 0,
				max: 100,
			},
			countTotal: {
				type: 'boolean',
				optional: true,
				default: false,
				convert: true,
			},
			nextKey: {
				type: 'string',
				optional: true,
				default: null,
			},
			reverse: {
				type: 'boolean',
				optional: true,
				default: false,
				convert: true,
			},
		},
		cache: {
			ttl: 10,
		},
	})
	async getHolderByAddress(ctx: Context<GetHolderRequest, Record<string, unknown>>) {
		let response: ResponseDto = {} as ResponseDto;
		if (ctx.params.nextKey) {
			try {
				new ObjectId(ctx.params.nextKey);
			} catch (error) {
				return (response = {
					code: ErrorCode.WRONG,
					message: ErrorMessage.VALIDATION_ERROR,
					data: {
						message: 'The nextKey is not a valid ObjectId',
					},
				});
			}
		}

		try {
			const query: QueryOptions = {};
			let sort = {};
			switch (ctx.params.contractType) {
				case CONTRACT_TYPE.CW4973:
				case CONTRACT_TYPE.CW721:
					sort = ctx.params.reverse
						? { quantity: 1, updatedAt: 1 }
						: { quantity: -1, updatedAt: -1 };
					query.is_burned = false;
					break;
				case CONTRACT_TYPE.CW20:
					sort = ctx.params.reverse
						? ['percent_hold', 'updatedAt']
						: ['-percent_hold', '-updatedAt'];
					query.balance = {
						$ne: '0',
					};
					break;
				default:
					break;
			}
			if (ctx.params.chainid) {
				query['custom_info.chain_id'] = ctx.params.chainid;
			}
			if (ctx.params.nextKey) {
				// eslint-disable-next-line no-underscore-dangle
				query._id = { $lt: new ObjectId(ctx.params.nextKey) };
				ctx.params.pageOffset = 0;
				ctx.params.countTotal = false;
			}
			if (ctx.params.contractAddress) {
				query.contract_address = ctx.params.contractAddress;
			}

			const [resultAsset, resultCount] = await Promise.all([
				this.broker.call(`v1.${ctx.params.contractType}-asset-manager.getHolderByAddress`, {
					query,
					limit: ctx.params.pageLimit,
					offset: ctx.params.pageOffset,
					sort,
					nextKey: ctx.params.nextKey,
				}),
				ctx.params.countTotal === true
					? this.broker.call(
							`v1.${ctx.params.contractType}-asset-manager.countHolderByAddress`,
							{
								query,
							},
					  )
					: 0,
			]);

			response = {
				code: ErrorCode.SUCCESSFUL,
				message: ErrorMessage.SUCCESSFUL,
				data: {
					resultAsset,
					resultCount,
				},
			};
		} catch (error) {
			response = {
				code: ErrorCode.WRONG,
				message: ErrorMessage.WRONG,
				data: {
					error,
				},
			};
		}
		return response;
	}

	/**
	 *  @swagger
	 *
	 *  /v1/asset/index:
	 *    post:
	 *      tags:
	 *      - "Asset"
	 *      summary:  Register asset CW20, CW721, CW4973 with the code id and contract type
	 *      description: Register asset CW20, CW721, CW4973 with the code id and contract type
	 *      requestBody:
	 *        content:
	 *          application/json:
	 *            schema:
	 *              type: object
	 *              properties:
	 *                codeId:
	 *                  type: number
	 *                  description: "Code id of stored contract"
	 *                contractType:
	 *                  type: string
	 *                  enum:
	 *                  - "CW721"
	 *                  - "CW20"
	 *                  - "CW4973"
	 *                  description: "Type of contract want to register"
	 *                chainId:
	 *                  type: string
	 *                  example: aura-testnet-2
	 *                  description: "Chain Id of network"
	 *      responses:
	 *        200:
	 *          description: Register asset result
	 *          content:
	 *            application/json:
	 *              schema:
	 *                type: object
	 *                properties:
	 *                  code:
	 *                    type: number
	 *                    example: 200
	 *                  message:
	 *                    type: string
	 *                    example: "Successful"
	 *                  data:
	 *                    type: object
	 *                    properties:
	 *                      registed:
	 *                        type: boolean
	 *                        example: true
	 *        422:
	 *          description: Bad request
	 *          content:
	 *            application/json:
	 *              schema:
	 *                type: object
	 *                properties:
	 *                  name:
	 *                    type: string
	 *                    example: "ValidationError"
	 *                  message:
	 *                    type: string
	 *                    example: "Parameters validation error!"
	 *                  code:
	 *                    type: number
	 *                    example: 422
	 *                  type:
	 *                    type: string
	 *                    example: "VALIDATION_ERROR"
	 *                  data:
	 *                    type: array
	 *                    items:
	 *                       type: object
	 *                       properties:
	 *                         type:
	 *                           type: string
	 *                           example: "required"
	 *                         message:
	 *                           type: string
	 *                           example: "The 'chainid' field is required."
	 *                         field:
	 *                           type: string
	 *                           example: chainid
	 *                         nodeID:
	 *                           type: string
	 *                           example: "node1"
	 *                         action:
	 *                           type: string
	 *                           example: "v1"
	 */

	/**
	 *  @swagger
	 *  /v1/asset/getByOwner:
	 *    get:
	 *      tags:
	 *        - Asset
	 *      summary: Get asset CW20, CW721, CW4973 by owner
	 *      description: Get asset CW20, CW721, CW4973 by owner
	 *      parameters:
	 *        - in: query
	 *          name: owner
	 *          required: false
	 *          schema:
	 *            type: string
	 *          description: "Owner address need to query"
	 *        - in: query
	 *          name: chainid
	 *          required: false
	 *          schema:
	 *            enum: ["aura-testnet-2","serenity-testnet-001","halo-testnet-001","theta-testnet-001","osmo-test-4","evmos_9000-4","euphoria-2","cosmoshub-4"]
	 *            type: string
	 *          description: "Chain Id of network need to query(if null it will return asset on all chainid)"
	 *        - in: query
	 *          name: contractType
	 *          required: true
	 *          schema:
	 *            enum: ["CW20","CW721", "CW4973"]
	 *            type: string
	 *            default: "CW20"
	 *          description: "Type asset need to query"
	 *        - in: query
	 *          name: tokenName
	 *          required: false
	 *          schema:
	 *            type: string
	 *          description: "Token name need to query"
	 *        - in: query
	 *          name: tokenId
	 *          required: false
	 *          schema:
	 *            type: string
	 *          description: "Token id need to query"
	 *        - in: query
	 *          name: contractAddress
	 *          required: false
	 *          schema:
	 *            type: string
	 *          description: "Contract address need to query"
	 *        - in: query
	 *          name: isBurned
	 *          required: false
	 *          schema:
	 *            type: boolean
	 *          description: "get token which is burned"
	 *        - in: query
	 *          name: countTotal
	 *          required: false
	 *          schema:
	 *            type: boolean
	 *            default: 'false'
	 *          description: "count total record"
	 *        - in: query
	 *          name: pageLimit
	 *          required: false
	 *          schema:
	 *            type: number
	 *            default: 10
	 *          description: "number record return in a page"
	 *        - in: query
	 *          name: pageOffset
	 *          required: false
	 *          schema:
	 *            type: number
	 *            default: 0
	 *          description: "Page number, start at 0"
	 *        - in: query
	 *          name: nextKey
	 *          required: false
	 *          schema:
	 *            type: string
	 *          description: "key for next page"
	 *      responses:
	 *        '200':
	 *          description: List asset
	 *          content:
	 *            application/json:
	 *              schema:
	 *                type: object
	 *                properties:
	 *                  code:
	 *                    type: number
	 *                    example: 200
	 *                  message:
	 *                    type: string
	 *                    example: "Successful"
	 *                  data:
	 *                    type: object
	 *                    properties:
	 *                      assets:
	 *                        type: object
	 *                        properties:
	 *                          CW721:
	 *                            type: object
	 *                            properties:
	 *                              asset:
	 *                                type: array
	 *                                items:
	 *                                  type: object
	 *                                  properties:
	 *                                    asset_info:
	 *                                      type: object
	 *                                      properties:
	 *                                        data:
	 *                                          type: object
	 *                                          properties:
	 *                                            access:
	 *                                              type: object
	 *                                              properties:
	 *                                                approvals:
	 *                                                  type: array
	 *                                                  items:
	 *                                                    type: object
	 *                                                owner:
	 *                                                  type: string
	 *                                                  example: 'aura123'
	 *                                            info:
	 *                                              type: object
	 *                                              properties:
	 *                                                token_uri:
	 *                                                  type: string
	 *                                                extension:
	 *                                                  type: object
	 *                                                  properties:
	 *                                                    image:
	 *                                                      type: string
	 *                                                    image_data:
	 *                                                      type: string
	 *                                                    external_url:
	 *                                                      type: string
	 *                                                    description:
	 *                                                      type: string
	 *                                                    name:
	 *                                                      type: string
	 *                                                    attributes:
	 *                                                      type: string
	 *                                                    background_color:
	 *                                                      type: string
	 *                                                    animation_url:
	 *                                                      type: string
	 *                                                    youtube_url:
	 *                                                      type: string
	 *                                    custom_info:
	 *                                      type: object
	 *                                      properties:
	 *                                        chain_id:
	 *                                          type: string
	 *                                          example: 'aura'
	 *                                        chain_name:
	 *                                          type: string
	 *                                          example: 'Aura network'
	 *                                    history:
	 *                                      type: array
	 *                                      items:
	 *                                        type: object
	 *                                    asset_id:
	 *                                      type: string
	 *                                    code_id:
	 *                                      type: string
	 *                                    contract_address:
	 *                                      type: string
	 *                                    token_id:
	 *                                      type: string
	 *                                    owner:
	 *                                      type: string
	 *                                    is_burned:
	 *                                      type: boolean
	 *                                    createdAt:
	 *                                      type: string
	 *                                      example: "2022-08-17T06:20:19.342Z"
	 *                                    updatedAt:
	 *                                      type: string
	 *                                      example: "2022-08-17T06:20:19.342Z"
	 *                                    metadata:
	 *                                      type: object
	 *                                      properties:
	 *                                        image:
	 *                                          type: string
	 *                                        image_data:
	 *                                          type: string
	 *                                        external_url:
	 *                                          type: string
	 *                                        description:
	 *                                          type: string
	 *                                        name:
	 *                                          type: string
	 *                                        attributes:
	 *                                          type: string
	 *                                        background_color:
	 *                                          type: string
	 *                                        animation_url:
	 *                                          type: string
	 *                                        youtube_url:
	 *                                          type: string
	 *                                    image:
	 *                                      type: object
	 *                                      properties:
	 *                                        link_s3:
	 *                                          type: string
	 *                                          example: "https://s3-horoscope/a"
	 *                                        content_type:
	 *                                          type: string
	 *                                          example: "image/jpg"
	 *                                    animation:
	 *                                      type: object
	 *                                      properties:
	 *                                        link_s3:
	 *                                          type: string
	 *                                          example: "https://s3-horoscope/b"
	 *                                        content_type:
	 *                                          type: string
	 *                                          example: "video/mp4"
	 *                              count:
	 *                                type: number
	 *                                example: 0
	 *                          "CW20":
	 *                            type: object
	 *                            properties:
	 *                              asset:
	 *                                type: array
	 *                                items:
	 *                                  properties:
	 *                                    asset_info:
	 *                                      type: object
	 *                                      properties:
	 *                                        data:
	 *                                          properties:
	 *                                            name:
	 *                                              type: string
	 *                                              example: "CW20-Aura"
	 *                                            symbol:
	 *                                              type: string
	 *                                              example: "SM"
	 *                                            decimal:
	 *                                              type: number
	 *                                              example: 6
	 *                                            total_supply:
	 *                                              type: string
	 *                                              example: "10000000000"
	 *                                    custom_info:
	 *                                      type: object
	 *                                      properties:
	 *                                        chain_id:
	 *                                          type: string
	 *                                          example: 'aura'
	 *                                        chain_name:
	 *                                          type: string
	 *                                          example: 'Aura network'
	 *                                    history:
	 *                                      type: array
	 *                                      items:
	 *                                        type: object
	 *                                    asset_id:
	 *                                      type: string
	 *                                    contract_address:
	 *                                      type: string
	 *                                    code_id:
	 *                                      type: string
	 *                                    owner:
	 *                                      type: string
	 *                                    balance:
	 *                                      type: string
	 *                                    percent_hold:
	 *                                      type: number
	 *                                      example: 10
	 *                                    createdAt:
	 *                                      type: string
	 *                                      example: "2022-08-17T06:20:19.342Z"
	 *                                    updatedAt:
	 *                                      type: string
	 *                                      example: "2022-08-17T06:20:19.342Z"
	 *                              count:
	 *                                type: number
	 *                                example: 0
	 *                          CW4973:
	 *                            type: object
	 *                            properties:
	 *                              asset:
	 *                                type: array
	 *                                items:
	 *                                  type: object
	 *                                  properties:
	 *                                    asset_info:
	 *                                      type: object
	 *                                      properties:
	 *                                        data:
	 *                                          type: object
	 *                                          properties:
	 *                                            access:
	 *                                              type: object
	 *                                              properties:
	 *                                                approvals:
	 *                                                  type: array
	 *                                                  items:
	 *                                                    type: object
	 *                                                owner:
	 *                                                  type: string
	 *                                                  example: 'aura123'
	 *                                            info:
	 *                                              type: object
	 *                                              properties:
	 *                                                token_uri:
	 *                                                  type: string
	 *                                                extension:
	 *                                                  type: string
	 *                                    custom_info:
	 *                                      type: object
	 *                                      properties:
	 *                                        chain_id:
	 *                                          type: string
	 *                                          example: 'aura'
	 *                                        chain_name:
	 *                                          type: string
	 *                                          example: 'Aura network'
	 *                                    history:
	 *                                      type: array
	 *                                      items:
	 *                                        type: object
	 *                                    asset_id:
	 *                                      type: string
	 *                                    code_id:
	 *                                      type: string
	 *                                    contract_address:
	 *                                      type: string
	 *                                    token_id:
	 *                                      type: string
	 *                                    owner:
	 *                                      type: string
	 *                                    is_burned:
	 *                                      type: boolean
	 *                                    createdAt:
	 *                                      type: string
	 *                                      example: "2022-08-17T06:20:19.342Z"
	 *                                    updatedAt:
	 *                                      type: string
	 *                                      example: "2022-08-17T06:20:19.342Z"
	 *                                    media_info:
	 *                                      type: array
	 *                                      items:
	 *                                        type: object
	 *                                        properties:
	 *                                          key:
	 *                                            type: string
	 *                                          media_link:
	 *                                            type: string
	 *                                            example: "s3://aws.aura.network"
	 *                                          status:
	 *                                            type: string
	 *                                            example: "COMPLETED"
	 *                                          createdAt:
	 *                                            type: string
	 *                                            example: "2022-08-17T06:20:19.342Z"
	 *                                          updatedAt:
	 *                                            type: string
	 *                                            example: "2022-08-17T06:20:19.342Z"
	 *                              count:
	 *                                type: number
	 *                                example: 0
	 *        '422':
	 *          description: Bad request
	 *          content:
	 *            application/json:
	 *              schema:
	 *                type: object
	 *                properties:
	 *                  name:
	 *                    type: string
	 *                    example: "ValidationError"
	 *                  message:
	 *                    type: string
	 *                    example: "Parameters validation error!"
	 *                  code:
	 *                    type: number
	 *                    example: 422
	 *                  type:
	 *                    type: string
	 *                    example: "VALIDATION_ERROR"
	 *                  data:
	 *                    type: array
	 *                    items:
	 *                       type: object
	 *                       properties:
	 *                         type:
	 *                           type: string
	 *                           example: "required"
	 *                         message:
	 *                           type: string
	 *                           example: "The 'owner' field is required."
	 *                         field:
	 *                           type: string
	 *                           example: owner
	 *                         nodeID:
	 *                           type: string
	 *                           example: "node1"
	 *                         action:
	 *                           type: string
	 *                           example: "v1.asset"
	 */

	/**
	 *  @swagger
	 *  /v1/asset/getByContractType:
	 *    get:
	 *      tags:
	 *        - Asset
	 *      summary: Get asset CW20, CW721, CW4973 by contract type
	 *      description: Get asset CW20, CW721, CW4973 by contract type

	 *      parameters:
	 *        - in: query
	 *          name: contractType
	 *          required: true
	 *          schema:
	 *            type: string
	 *            enum: ["CW721", "CW20", "CW4973"]
	 *          description: "Contract type need to query"
	 *        - in: query
	 *          name: chainid
	 *          required: false
	 *          schema:
	 *            type: string
	 *            enum: ["aura-testnet-2","serenity-testnet-001","halo-testnet-001","theta-testnet-001","osmo-test-4","evmos_9000-4","euphoria-2","cosmoshub-4"]
	 *          description: "Chain Id of network need to query"
	 *          example: "aura-testnet-2"
	 *        - in: query
	 *          name: pageLimit
	 *          required: false
	 *          schema:
	 *            type: number
	 *            default: 10
	 *          description: "number record return in a page"
	 *        - in: query
	 *          name: pageOffset
	 *          required: false
	 *          schema:
	 *            type: number
	 *            default: 0
	 *          description: "Page number, start at 0"
	 *        - in: query
	 *          name: countTotal
	 *          required: false
	 *          schema:
	 *            default: false
	 *            type: boolean
	 *          description: "count total record"
	 *        - in: query
	 *          name: nextKey
	 *          required: false
	 *          schema:
	 *            type: string
	 *          description: "key for next page"
	 *      responses:
	 *        '200':
	 *          description: Asset
	 *          content:
	 *            application/json:
	 *              schema:
	 *                type: object
	 *                properties:
	 *                  code:
	 *                    type: number
	 *                    example: 200
	 *                  message:
	 *                    type: string
	 *                    example: "Successful"
	 *                  data:
	 *                    type: object
	 *                    properties:
	 *                      assets:
	 *                        type: array
	 *                        items:
	 *                          type: object
	 *                          properties:
	 *                            asset_info:
	 *                              type: object
	 *                              properties:
	 *                                data:
	 *                                  type: object
	 *                                  properties:
	 *                                    access:
	 *                                      type: object
	 *                                      properties:
	 *                                        approvals:
	 *                                          type: array
	 *                                          items:
	 *                                            type: object
	 *                                        owner:
	 *                                          type: string
	 *                                          example: 'aura123'
	 *                                    info:
	 *                                      type: object
	 *                                      properties:
	 *                                        token_uri:
	 *                                          type: string
	 *                                        extension:
	 *                                          type: object
	 *                                          properties:
	 *                                            image:
	 *                                              type: string
	 *                                            image_data:
	 *                                              type: string
	 *                                            external_url:
	 *                                              type: string
	 *                                            description:
	 *                                              type: string
	 *                                            name:
	 *                                              type: string
	 *                                            attributes:
	 *                                              type: string
	 *                                            background_color:
	 *                                              type: string
	 *                                            animation_url:
	 *                                              type: string
	 *                                            youtube_url:
	 *                                              type: string
	 *                            custom_info:
	 *                              type: object
	 *                              properties:
	 *                                chain_id:
	 *                                  type: string
	 *                                  example: 'aura'
	 *                                chain_name:
	 *                                  type: string
	 *                                  example: 'Aura network'
	 *                            history:
	 *                              type: array
	 *                              items:
	 *                                type: object
	 *                            asset_id:
	 *                              type: string
	 *                            code_id:
	 *                              type: string
	 *                            contract_address:
	 *                              type: string
	 *                            token_id:
	 *                              type: string
	 *                            owner:
	 *                              type: string
	 *                            is_burned:
	 *                              type: boolean
	 *                            createdAt:
	 *                              type: string
	 *                              example: "2022-08-17T06:20:19.342Z"
	 *                            updatedAt:
	 *                              type: string
	 *                              example: "2022-08-17T06:20:19.342Z"
	 *                            metadata:
	 *                              type: object
	 *                              properties:
	 *                                image:
	 *                                  type: string
	 *                                image_data:
	 *                                  type: string
	 *                                external_url:
	 *                                  type: string
	 *                                description:
	 *                                  type: string
	 *                                name:
	 *                                  type: string
	 *                                attributes:
	 *                                  type: string
	 *                                background_color:
	 *                                  type: string
	 *                                animation_url:
	 *                                  type: string
	 *                                youtube_url:
	 *                                  type: string
	 *                            image:
	 *                              type: object
	 *                              properties:
	 *                                link_s3:
	 *                                  type: string
	 *                                  example: "https://s3-horoscope/a"
	 *                                content_type:
	 *                                  type: string
	 *                                  example: "image/jpg"
	 *                            animation:
	 *                              type: object
	 *                              properties:
	 *                                link_s3:
	 *                                  type: string
	 *                                  example: "https://s3-horoscope/b"
	 *                                content_type:
	 *                                  type: string
	 *                                  example: "video/mp4"
	 *
	 *                      count:
	 *                        type: number
	 *                        example: 0
	 *                      nextKey:
	 *                        type: string
	 *                        example: 'xxxxxxxxxxxx'
	 *        '422':
	 *          description: Bad request
	 *          content:
	 *            application/json:
	 *              schema:
	 *                type: object
	 *                properties:
	 *                  name:
	 *                    type: string
	 *                    example: "ValidationError"
	 *                  message:
	 *                    type: string
	 *                    example: "Parameters validation error!"
	 *                  code:
	 *                    type: number
	 *                    example: 422
	 *                  type:
	 *                    type: string
	 *                    example: "VALIDATION_ERROR"
	 *                  data:
	 *                    type: array
	 *                    items:
	 *                       type: object
	 *                       properties:
	 *                         type:
	 *                           type: string
	 *                           example: "required"
	 *                         message:
	 *                           type: string
	 *                           example: "The 'chainid' field is required."
	 *                         field:
	 *                           type: string
	 *                           example: chainid
	 *                         nodeID:
	 *                           type: string
	 *                           example: "node1"
	 *                         action:
	 *                           type: string
	 *                           example: "v1.account-info"
	 */
	/**
	 *  @swagger
	 *  /v1/asset/holder:
	 *    get:
	 *      tags:
	 *        - Asset
	 *      summary: Get holder by asset CW20, CW721, CW4973 (contractType and contractAddress)
	 *      description: Get holder by asset CW20, CW721, CW4973 (contractType and contractAddress)
	 *      parameters:
	 *        - in: query
	 *          name: chainid
	 *          required: true
	 *          schema:
	 *            type: string
	 *            enum: ["aura-testnet-2","serenity-testnet-001","halo-testnet-001","theta-testnet-001","osmo-test-4","evmos_9000-4","euphoria-2","cosmoshub-4"]
	 *          description: "Chain Id of network need to query"
	 *          example: "aura-testnet-2"
	 *        - in: query
	 *          name: contractType
	 *          required: true
	 *          schema:
	 *            type: string
	 *            enum: ["CW721", "CW20", "CW4973"]
	 *          description: "Contract type need to query"
	 *        - in: query
	 *          name: contractAddress
	 *          required: true
	 *          schema:
	 *            type: string
	 *          description: "asset/contract address need to query"
	 *        - in: query
	 *          name: pageLimit
	 *          required: false
	 *          schema:
	 *            type: number
	 *            default: 10
	 *          description: "number record return in a page"
	 *        - in: query
	 *          name: pageOffset
	 *          required: false
	 *          schema:
	 *            type: number
	 *            default: 0
	 *          description: "Page number, start at 0"
	 *        - in: query
	 *          name: countTotal
	 *          required: false
	 *          schema:
	 *            type: boolean
	 *            default: 'false'
	 *          description: "count total record"
	 *        - in: query
	 *          name: nextKey
	 *          required: false
	 *          schema:
	 *            type: string
	 *          description: "key for next page"
	 *        - in: query
	 *          name: reverse
	 *          required: false
	 *          schema:
	 *            type: string
	 *            default: 'false'
	 *            enum: ["true","false"]
	 *          description: "reverse is true if you want to get the by percent hold cw20, default is false"
	 *      responses:
	 *        '200':
	 *          description: list holder
	 *          content:
	 *            application/json:
	 *              schema:
	 *                type: object
	 *                properties:
	 *                  code:
	 *                    type: number
	 *                    example: 200
	 *                  message:
	 *                    type: string
	 *                    example: "Successful"
	 *                  data:
	 *                    type: object
	 *                    properties:
	 *                      resultAsset:
	 *                        type: array
	 *                        items:
	 *                          properties:
	 *                            quantity:
	 *                              type: number
	 *                              example: 5
	 *                            updatedAt:
	 *                              type: string
	 *                              example: "2022-09-06T08:09:27.473Z"
	 *                            chain_id:
	 *                              type: string
	 *                              example: "aura"
	 *                            owner:
	 *                              type: string
	 *                            contract_address:
	 *                              type: string
	 *                            balance:
	 *                              type: string
	 *                            percent_hold:
	 *                              type: number
	 *                              example: 100
	 *        '422':
	 *          description: Bad request
	 *          content:
	 *            application/json:
	 *              schema:
	 *                type: object
	 *                properties:
	 *                  name:
	 *                    type: string
	 *                    example: "ValidationError"
	 *                  message:
	 *                    type: string
	 *                    example: "Parameters validation error!"
	 *                  code:
	 *                    type: number
	 *                    example: 422
	 *                  type:
	 *                    type: string
	 *                    example: "VALIDATION_ERROR"
	 *                  data:
	 *                    type: array
	 *                    items:
	 *                       type: object
	 *                       properties:
	 *                         type:
	 *                           type: string
	 *                           example: "required"
	 *                         message:
	 *                           type: string
	 *                           example: "The 'chainid' field is required."
	 *                         field:
	 *                           type: string
	 *                           example: chainid
	 *                         nodeID:
	 *                           type: string
	 *                           example: "node1"
	 *                         action:
	 *                           type: string
	 *                           example: "v1.block.chain"
	 */
}
