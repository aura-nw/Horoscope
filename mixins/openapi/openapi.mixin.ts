/* eslint-disable prefer-arrow/prefer-arrow-functions */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
'use strict';
/**
 * Mixin for swagger
 */
import { writeFileSync, readFileSync } from 'fs';
import { Errors } from 'moleculer';
import ApiGateway from 'moleculer-web';
import SwaggerUI from 'swagger-ui-dist';
import _ from 'lodash';
import swaggerJSDoc from 'swagger-jsdoc';
import * as pkg from '../../package.json';
import { Config } from '../../common';
import { LIST_NETWORK } from '../../common/constant';
// eslint-disable-next-line @typescript-eslint/naming-convention
const MoleculerServerError = Errors.MoleculerServerError;

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

const listLCD: any[] = [];
LIST_NETWORK.map((e) => {
	const listlcd = e.LCD;
	listlcd.map((lcd) => {
		listLCD.push({ url: lcd, description: `${e.chainName} LCD` });
	});
});

export const openAPIMixin = (mixinOptions?: any) => {
	mixinOptions = _.defaultsDeep(mixinOptions, {
		routeOptions: {
			path: '/openapi',
		},
		schema: null,
	});

	let shouldUpdateSchema = true;
	let schema: any = null;

	return {
		events: {
			'$services.changed'() {
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-ignore
				this.invalidateOpenApiSchema();
			},
		},

		methods: {
			/**
			 * Invalidate the generated OpenAPI schema
			 */
			invalidateOpenApiSchema() {
				shouldUpdateSchema = true;
			},

			/**
			 * Generate OpenAPI Schema
			 */
			generateOpenAPISchema(): any {
				try {
					let url = Config.SWAGGER_HOST;
					if (Config.SWAGGER_PORT) {
						url += `:${Config.BASE_PORT}`;
					}
					url += `${Config.SWAGGER_BASEPATH}`;

					const swaggerDefinition = {
						openapi: '3.0.0',
						info: {
							title: 'Horoscope API Documentation', // Title of the documentation
							version: pkg.version, // Version of the app
							description: `## Indexer for multiple Cosmos Network \n
### How to use\n
Select server Horoscope if use Horoscope API\n
Select server LCD if use Legacy API`,
							// eslint-disable-next-line max-len
							// 'Indexer for multiple Cosmos Network',
						},
						// Host: `${Config.SWAGGER_HOST}:${Config.SWAGGER_PORT}`, // The host or url of the app
						// BasePath: `${Config.SWAGGER_BASEPATH}`, // The basepath of your endpoint
						servers: [
							{
								url,
								description: 'Horoscope ',
							},
							...listLCD.map((e) => ({
								url: e.url,
								description: e.description,
							})),
						],
					};
					// Options for the swagger docs
					const options = {
						// Import swaggerDefinitions
						definition: swaggerDefinition,
						explorer: true,
						enableCORS: false,

						// Path to the API docs
						// eslint-disable-next-line @typescript-eslint/ban-ts-comment
						// @ts-ignore
						apis: JSON.parse(Config.SWAGGER_APIS),
					};
					// Initialize swagger-jsdoc
					const swaggerSpec = swaggerJSDoc(options);

					return swaggerSpec;
				} catch (err) {
					throw new MoleculerServerError(
						'Unable to compile OpenAPI schema',
						500,
						'UNABLE_COMPILE_OPENAPI_SCHEMA',
						{ err },
					);
				}
			},
		},

		async created() {
			const pathToSwaggerUi = SwaggerUI.absolutePath();

			let swaggerUrl = `${Config.BASE_URL}`;
			if (Config.BASE_PORT) {
				swaggerUrl += `:${Config.BASE_PORT}`;
			}

			const swaggerUIInitialized = readFileSync(`${pathToSwaggerUi}/swagger-initializer.js`)
				.toString()
				.replace(
					'https://petstore.swagger.io/v2/swagger.json',
					`${swaggerUrl}/openapi/swagger.json`,
				);
			writeFileSync(`${pathToSwaggerUi}/swagger-initializer.js`, swaggerUIInitialized);

			const indexContent = readFileSync(`${pathToSwaggerUi}/index.html`)
				.toString()
				.replace(
					// eslint-disable-next-line max-len
					/(?:(?:https?|undefined):(\/\/|undefined?)|www\.)(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[-A-Z0-9+&@#\/%=~_|$?!:,.])*(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[A-Z0-9+&@#\/%=~_|$])/gim,
					`${swaggerUrl}/openapi/swagger.json`,
				)
				.replace('layout: "StandaloneLayout"', '');
			writeFileSync(`${pathToSwaggerUi}/index.html`, indexContent);
			const route = _.defaultsDeep(mixinOptions.routeOptions, {
				use: [ApiGateway.serveStatic(SwaggerUI.absolutePath())],

				aliases: {
					// eslint-disable-next-line @typescript-eslint/ban-ts-comment
					// @ts-ignore
					'GET /swagger.json'(req, res) {
						// Send back the generated schema
						if (shouldUpdateSchema || !schema) {
							// Create new server & regenerate GraphQL schema
							// eslint-disable-next-line @typescript-eslint/ban-ts-comment
							// @ts-ignore
							this.logger.info('♻ Regenerate OpenAPI/Swagger schema...');

							try {
								// eslint-disable-next-line @typescript-eslint/ban-ts-comment
								// @ts-ignore
								schema = this.generateOpenAPISchema();

								shouldUpdateSchema = false;

								// eslint-disable-next-line @typescript-eslint/ban-ts-comment
								// @ts-ignore
								this.logger.debug(schema);
								if (Config.REWRITE_SWAGGER === 'true') {
									writeFileSync(
										'./swagger.json',
										JSON.stringify(schema, null, 4),
										'utf8',
									);
								}
								//  Else {
								// 	Schema = readFileSync('./swagger.json');
								// }
							} catch (err) {
								// eslint-disable-next-line @typescript-eslint/ban-ts-comment
								// @ts-ignore
								this.logger.warn(err);
								// eslint-disable-next-line @typescript-eslint/ban-ts-comment
								// @ts-ignore
								this.sendError(req, res, err);
							}
						}

						const ctx = req.$ctx;
						ctx.meta.responseType = 'application/json';

						// eslint-disable-next-line @typescript-eslint/ban-ts-comment
						// @ts-ignore
						return this.sendResponse(req, res, schema);
					},
				},

				mappingPolicy: 'restrict',
			});

			// Add route
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			this.settings.routes.unshift(route);
		},

		async started() {
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			this.logger.info(
				`♻ OpenAPI Docs server is available at ${mixinOptions.routeOptions.path}`,
			);
		},
	};
};

module.exports = { openAPIMixin };
