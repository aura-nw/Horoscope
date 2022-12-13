/* eslint-disable camelcase */
/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable max-classes-per-file */
import { JsonObject, JsonProperty } from 'json2typescript';

@JsonObject('DetailError')
export class DetailError {
	@JsonProperty('@type', String)
	'@type': String = '';
}

@JsonObject('Error')
export class Error {
	@JsonProperty('code', Number)
	amount: Number = 0;
	@JsonProperty('message', String)
	message: String = '';
	@JsonProperty('data', DetailError)
	data: DetailError = new DetailError();
}
