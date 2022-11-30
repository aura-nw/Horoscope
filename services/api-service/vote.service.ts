import { dbVoteMixin } from './../../mixins/dbMixinMongoose/db-vote.mixin';
import { redisMixin } from './../../mixins/redis/redis.mixin';
import { Service, Get, Action } from '@ourparentcenter/moleculer-decorators-extended';
import { LIST_NETWORK } from '../../common/constant';
import { IVote } from '../../entities/vote.entity';
import { Context } from 'moleculer';
import { QueryOptions } from 'moleculer-db';
import { ObjectId } from 'mongodb';
import {
	CountVoteParams,
	CountVoteResponse,
	ErrorCode,
	ErrorMessage,
	GetVoteRequest,
	MoleculerDBService,
	ValidatorVoteResponse,
} from '../../types';
import { fromBase64, fromUtf8, toBase64, toUtf8 } from '@cosmjs/encoding';
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */
@Service({
	name: 'votes',
	version: 1,
	mixins: [dbVoteMixin, redisMixin],
})
export default class VoteService extends MoleculerDBService<{ rest: 'v1/votes' }, IVote> {
	@Get('/', {
		name: 'getVotes',
		params: {
			chainid: {
				type: 'string',
				optional: false,
				enum: LIST_NETWORK.map((e) => {
					return e.chainId;
				}),
			},
			proposalid: {
				type: 'number',
				optional: false,
				default: 1,
				integer: true,
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
	async getVotes(ctx: Context<GetVoteRequest, Record<string, unknown>>) {
		let nextKey: any = null;
		if (ctx.params.nextKey) {
			try {
				nextKey = JSON.parse(fromUtf8(fromBase64(ctx.params.nextKey)));
				if (!(nextKey._id && nextKey.height)) {
					throw new Error('The nextKey is not a valid next key');
				}
			} catch (error) {
				return {
					code: ErrorCode.WRONG,
					message: ErrorMessage.VALIDATION_ERROR,
					data: {
						message: 'The nextKey is not a valid next key',
					},
				};
			}
		}
		try {
			let query: QueryOptions = {};
			query['proposal_id'] = ctx.params.proposalid;
			const chainId = ctx.params.chainid;
			if (ctx.params.answer) query.answer = ctx.params.answer;

			let sort = '-height';

			if (ctx.params.reverse) {
				sort = 'height';
			}

			if (nextKey) {
				if (ctx.params.reverse) {
					query._id = { $gt: new ObjectId(nextKey._id) };
					query['height'] = { $gte: nextKey.height };
				} else {
					query._id = { $lt: new ObjectId(nextKey._id) };
					query['height'] = { $lte: nextKey.height };
				}
			}

			const network = LIST_NETWORK.find((x) => x.chainId == ctx.params.chainid);
			if (network && network.databaseName) {
				this.adapter.useDb(network.databaseName);
			}
			// find pageLimit + 1 to check if there is a next page
			const votes: any[] = await this.adapter.find({
				query,
				limit: ctx.params.pageLimit + 1,
				offset: ctx.params.pageOffset,
				// @ts-ignore
				sort: sort,
			});

			// check if there is a next page
			const newNextKey =
				votes.length < 1 || votes.length <= ctx.params.pageLimit
					? null
					: { _id: votes[votes.length - 2]._id, height: votes[votes.length - 2].height };

			// remove the last item if there is a next page
			if (nextKey) {
				votes.pop();
			}
			return {
				code: ErrorCode.SUCCESSFUL,
				message: ErrorMessage.SUCCESSFUL,
				data: {
					votes,
					nextKey: toBase64(toUtf8(JSON.stringify(newNextKey))),
				},
			};
		} catch (err) {
			return {
				code: ErrorCode.WRONG,
				message: ErrorMessage.WRONG,
				data: {
					err,
				},
			};
		}
	}

	@Get('/validators', {
		name: 'getValidatorVote',
		params: {
			chainid: {
				type: 'string',
				optional: false,
				enum: LIST_NETWORK.map((e) => {
					return e.chainId;
				}),
			},
			proposalid: {
				type: 'number',
				optional: false,
				default: 1,
				integer: true,
				convert: true,
			},
		},
		cache: {
			ttl: 10,
		},
	})
	async getValidatorVote(ctx: Context<GetVoteRequest, Record<string, unknown>>) {
		try {
			const chainId = ctx.params.chainid;
			const validators: any[] = await this.broker.call(
				'v1.validator.getByCondition',
				{
					query: {
						'custom_info.chain_id': chainId,
						status: 'BOND_STATUS_BONDED',
					},
					sort: '-percent_voting_power',
				},
				{ meta: { $cache: false } },
			);
			const validatorAccountAddress = validators.map((e) => {
				return e.account_address;
			});
			let query: QueryOptions = {
				proposal_id: ctx.params.proposalid,
				voter_address: { $in: validatorAccountAddress },
			};
			if (ctx.params.answer) query.answer = ctx.params.answer;
			const network = LIST_NETWORK.find((x) => x.chainId == chainId);
			if (network && network.databaseName) {
				this.adapter.useDb(network.databaseName);
			}
			const votes: any[] = await this.adapter.find({ query });

			const validatorVotes: ValidatorVoteResponse[] = [];
			for (let i = 0; i < validators.length; i++) {
				const validator = validators[i];
				const vote = votes.find((e) => {
					return e.voter_address === validator.account_address;
				});
				const tx_hash = vote ? vote.txhash : '';
				const answer = vote ? vote.answer : '';
				const timestamp = vote ? vote.timestamp : '';
				validatorVotes.push({
					rank: (i + 1).toString(),
					percent_voting_power: validator.percent_voting_power,
					validator_address: validator.account_address,
					operator_address: validator.operator_address,
					validator_identity: validator.description.identity,
					validator_name: validator.description.moniker,
					answer,
					tx_hash,
					timestamp,
				});
			}
			return {
				code: ErrorCode.SUCCESSFUL,
				message: ErrorMessage.SUCCESSFUL,
				data: validatorVotes,
			};
		} catch (err) {
			return {
				code: ErrorCode.WRONG,
				message: ErrorMessage.WRONG,
				data: {
					err,
				},
			};
		}
	}

	@Action()
	async countVotes(ctx: Context<CountVoteParams>): Promise<CountVoteResponse[]> {
		// @ts-ignore
		this.logger.debug(
			`ctx.params proposal-vote-manager count votes ${JSON.stringify(ctx.params)}`,
		);

		const { chain_id, proposal_id } = ctx.params;
		const network = LIST_NETWORK.find((x) => x.chainId == chain_id);
		if (network && network.databaseName) {
			this.adapter.useDb(network.databaseName);
		}
		// @ts-ignore
		const data = await this.adapter.aggregate([
			{
				$match: {
					proposal_id,
				},
			},
			{
				$group: {
					_id: {
						answer: '$answer',
					},
					count: {
						$sum: 1,
					},
				},
			},
		]);
		const countVoteResult = [];
		for (const item of data) {
			const countVoteType: CountVoteResponse = {
				answer: item._id.answer,
				count: item.count,
			};
			countVoteResult.push(countVoteType);
		}
		this.logger.debug(countVoteResult);

		return countVoteResult;
	}

	/**
	 *  @swagger
	 *  /v1/votes:
	 *    get:
	 *      tags:
	 *        - Vote
	 *      summary: Get votes
	 *      description: Get votes
	 *      parameters:
	 *        - in: query
	 *          name: chainid
	 *          required: true
	 *          schema:
	 *            type: string
<<<<<<< HEAD
	 *            enum: ["euphoria-2","cosmoshub-4","osmosis-1"]
=======
	 *            enum: ["euphoria-1","euphoria-2","cosmoshub-4","osmosis-1"]
>>>>>>> 29e9d9857164934e725a335dc501e8d2faf2da28
	 *          description: "Chain Id of network need to query"
	 *        - in: query
	 *          name: proposalid
	 *          required: true
	 *          schema:
	 *            type: number
	 *            default: 1
	 *          description: "Proposal Id"
	 *        - in: query
	 *          name: answer
	 *          required: false
	 *          schema:
	 *            type: string
	 *            enum: ['VOTE_OPTION_YES', 'VOTE_OPTION_NO', 'VOTE_OPTION_NO_WITH_VETO', 'VOTE_OPTION_ABSTAIN']
	 *          description: "Vote option want to query"
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
	 *        - in: query
	 *          name: reverse
	 *          required: false
	 *          schema:
	 *            enum: ["true","false"]
	 *            default: "false"
	 *            type: string
	 *          description: "reverse is true if you want to get the oldest record first, default is false"
	 *      responses:
	 *        '200':
	 *          description: Vote result
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
	 *                      votes:
	 *                        type: array
	 *                        items:
	 *                          type: object
	 *                          properties:
	 *                            voter_address:
	 *                              type: string
	 *                              example: 'aura1hctj3tpmucmuv02umf9252enjedkce7mml69k8'
	 *                            proposal_id:
	 *                              type: number
	 *                              example: 1
	 *                            answer:
	 *                              type: string
	 *                              example: 'Yes'
	 *                            txhash:
	 *                              type: string
	 *                              example: '698185B1800A077B30A61ADBC42958CFCCFE5C3DA0D32E0AF314C0098684CCC6'
	 *                            timestamp:
	 *                              type: string
	 *                              example: '2021-05-20T09:00:00.000Z'
	 *                            custom_info:
	 *                              type: object
	 *                              properties:
	 *                                chain_id:
	 *                                  type: string
	 *                                  example: 'aura-testnet-2'
	 *                                chain_name:
	 *                                  type: string
	 *                                  example: 'Aura Testnet'
	 *                      nextKey:
	 *                        type: string
	 *                        example: '63218f7c8c9c740a4dcefaf2'
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
	 *  /v1/votes/validators:
	 *    get:
	 *      tags:
	 *        - Vote
	 *      summary: Get validator votes
	 *      description: Get validator votes
	 *      parameters:
	 *        - in: query
	 *          name: chainid
	 *          required: true
	 *          schema:
	 *            type: string
<<<<<<< HEAD
	 *            enum: ["euphoria-2","cosmoshub-4","osmosis-1"]
=======
	 *            enum: ["euphoria-1","euphoria-2","cosmoshub-4","osmosis-1"]
>>>>>>> 29e9d9857164934e725a335dc501e8d2faf2da28
	 *          description: "Chain Id of network need to query"
	 *        - in: query
	 *          name: proposalid
	 *          required: true
	 *          schema:
	 *            type: number
	 *            default: 1
	 *          description: "Proposal Id"
	 *        - in: query
	 *          name: answer
	 *          required: false
	 *          schema:
	 *            type: string
	 *            enum: ['VOTE_OPTION_YES', 'VOTE_OPTION_NO', 'VOTE_OPTION_NO_WITH_VETO', 'VOTE_OPTION_ABSTAIN', 'DID_NOT_VOTE']
	 *          description: "Vote option want to query"
	 *      responses:
	 *        '200':
	 *          description: Validator Vote result
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
	 *                      votes:
	 *                        type: array
	 *                        items:
	 *                          type: object
	 *                          properties:
	 *                            voter_address:
	 *                              type: string
	 *                              example: 'aura1hctj3tpmucmuv02umf9252enjedkce7mml69k8'
	 *                            proposal_id:
	 *                              type: number
	 *                              example: 1
	 *                            answer:
	 *                              type: string
	 *                              example: 'Yes'
	 *                            txhash:
	 *                              type: string
	 *                              example: '698185B1800A077B30A61ADBC42958CFCCFE5C3DA0D32E0AF314C0098684CCC6'
	 *                            timestamp:
	 *                              type: string
	 *                              example: '2021-05-20T09:00:00.000Z'
	 *                            custom_info:
	 *                              type: object
	 *                              properties:
	 *                                chain_id:
	 *                                  type: string
	 *                                  example: 'aura-testnet-2'
	 *                                chain_name:
	 *                                  type: string
	 *                                  example: 'Aura Testnet'
	 *                      nextKey:
	 *                        type: string
	 *                        example: '63218f7c8c9c740a4dcefaf2'
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
}
