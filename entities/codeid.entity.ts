/* eslint-disable camelcase */
/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable max-classes-per-file */
import { Config } from 'common';
import { JsonObject, JsonProperty } from 'json2typescript';
import { Types } from 'mongoose';

export interface ICoin {
	amount: String;
	denom: String;
}

@JsonObject('Asset')
export class AssetEntity {
	@JsonProperty('_id', String, true)
	_id = Config.DB_BLOCK.dialect === 'local' ? Types.ObjectId() : null;
	// @JsonProperty('asset_id', String)
	code_id: String = '';
	asset_id: String = '';
	contract_address: String = '';
	token_id: String = '';
	owner: String = '';
	history: String[] = [];
	// @JsonProperty('asset_info', Object)
	asset_info: Object = {};

	is_burned: Boolean = true;
	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public getMongoEntity() {
		// eslint-disable-next-line no-underscore-dangle
		return { ...this, _id: this._id && this._id.toString() };
	}
}
