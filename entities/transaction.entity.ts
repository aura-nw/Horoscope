/* eslint-disable camelcase */
/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable max-classes-per-file */
import { JsonObject, JsonProperty } from 'json2typescript';
import { Types } from 'mongoose';
import { Config } from '../common';
import { Coin, ICoin } from './coin.entity';
import { NumericConverter } from './converters/numeric.converter';
import { DateConverter } from './converters/date.converter';
import { CustomInfo, ICustomInfo } from './custom-info.entity';

export interface ITransaction {
	_id: Types.ObjectId | string | null;
	tx: ITxInput;
	tx_response: ITxResponse;
	custom_info: ICustomInfo;
	indexes: Object;
}

export interface IPublicKey {
	'@type': String;
	key: String;
}

export interface IMode {
	mode: String;
}
export interface IModeInfo {
	single: IMode;
}
export interface IBody {
	messages: Object[];
	memo: String;
	timeout_height: String;
	extension_options: Object[];
	non_critical_extension_options: Object[];
}
export interface ISignerInfo {
	public_key: IPublicKey;
	mode_info: IModeInfo;
	sequence: String;
}
export interface IFee {
	amount: ICoin[];
	gas_limit: String;
	payer: String;
	granter: String;
}
export interface IAuthInfo {
	signer_infos: ISignerInfo[];
	fee: IFee;
}
export interface ITxInput {
	body: IBody;
	auth_info: IAuthInfo;
	signatures: String[];
}
export interface IAttribute {
	key: String;
	value: String;
	index: Boolean;
}
export interface IEvent {
	type: String;
	attributes: IAttribute[];
}
export interface ILog {
	msg_index: Number;
	log: String;
	events: IEvent[];
}
export interface ITxResponse {
	height: Number;
	txhash: String;
	codespace: String;
	code: String;
	data: String;
	raw_log: String;
	logs: ILog[];
	info: String;
	gas_wanted: String;
	gas_used: String;
	tx: Object;
	timestamp: Date | null;
	events: IEvent[];
}

export class PublicKey implements IPublicKey {
	@JsonProperty('@type', String)
	'@type': String = '';
	@JsonProperty('key', String)
	key: String = '';
}

export class Mode implements IMode {
	@JsonProperty('mode', String)
	mode: String = '';
}
export class ModeInfo implements IModeInfo {
	@JsonProperty('single', Mode)
	single: IMode = {} as IMode;
}
export class Body implements IBody {
	@JsonProperty('messages', [Object])
	messages: Object[] = [];
	@JsonProperty('memo', String)
	memo: String = '';
	@JsonProperty('timeout_height', String)
	timeout_height: String = '';
	@JsonProperty('extension_options', [Object])
	extension_options: Object[] = [];
	@JsonProperty('non_critical_extension_options', [Object])
	non_critical_extension_options: Object[] = [];
}
export class SignerInfo implements ISignerInfo {
	@JsonProperty('public_key', PublicKey)
	public_key: PublicKey = {} as PublicKey;
	@JsonProperty('mode_info', ModeInfo)
	mode_info: ModeInfo = {} as ModeInfo;
	@JsonProperty('sequence', String)
	sequence: String = '';
}
export class Fee implements IFee {
	@JsonProperty('amount', [Coin])
	amount: Coin[] = [];
	@JsonProperty('gas_limit', String)
	gas_limit: String = '';
	@JsonProperty('payer', String)
	payer: String = '';
	@JsonProperty('granter', String)
	granter: String = '';
}
export class AuthInfo implements IAuthInfo {
	@JsonProperty('signer_infos', [SignerInfo])
	signer_infos: SignerInfo[] = [];
	@JsonProperty('fee', Fee)
	fee: Fee = {} as Fee;
}
export class TxInput implements ITxInput {
	@JsonProperty('body', Body)
	body: Body = {} as Body;
	@JsonProperty('auth_info', AuthInfo)
	auth_info: AuthInfo = {} as AuthInfo;
	@JsonProperty('signature', [String])
	signatures: String[] = [];
}
export class Attribute implements IAttribute {
	@JsonProperty('key', String)
	key: String = '';
	@JsonProperty('value', String)
	value: String = '';
	@JsonProperty('index', Boolean, true)
	index: Boolean = false;
}
export class Event implements IEvent {
	@JsonProperty('type', String)
	type: String = '';
	@JsonProperty('attributes', [Attribute])
	attributes: IAttribute[] = [];
}
export class Log implements ILog {
	@JsonProperty('msg_index', Number)
	msg_index: Number = 0;
	@JsonProperty('log', String)
	log: String = '';
	@JsonProperty('events', [Event])
	events: IEvent[] = [];
}

export class TxResponse implements ITxResponse {
	@JsonProperty('height', NumericConverter)
	height: Number = 0;
	@JsonProperty('txhash', String)
	txhash: String = '';
	@JsonProperty('codespace', String)
	codespace: String = '';
	@JsonProperty('code', String)
	code: String = '';
	@JsonProperty('data', String)
	data: String = '';
	@JsonProperty('raw_log', String)
	raw_log: String = '';
	@JsonProperty('logs', [Log])
	logs: ILog[] = [];
	@JsonProperty('info', String)
	info: String = '';
	@JsonProperty('gas_wanted', String)
	gas_wanted: String = '';
	@JsonProperty('gas_used', String)
	gas_used: String = '';
	@JsonProperty('tx', Object)
	tx: Object = {};
	@JsonProperty('timestamp', DateConverter)
	timestamp: Date | null = null;
	@JsonProperty('events', [Event])
	events: Event[] = [];
}

@JsonObject('MsgBank')
export class MsgBank {
	@JsonProperty('from_address', String, true)
	from_address: String = '';
	@JsonProperty('to_address', String, true)
	to_address: String = '';
	@JsonProperty('amount', [Coin], true)
	amount: Coin[] = [];
}
@JsonObject('MsgCreateVestingAccount')
export class MsgCreateVestingAccount {
	@JsonProperty('from_address', String, true)
	from_address: String = '';
	@JsonProperty('to_address', String, true)
	to_address: String = '';
	@JsonProperty('amount', [Coin], true)
	amount: Coin[] = [];
	@JsonProperty('end_time', String, true)
	end_time: String = '';
	@JsonProperty('delayed', String, true)
	delayed: String = '';
}
@JsonObject('Grant')
export class Grant {
	@JsonProperty('authorization', String, true)
	authorization: String = '';
	@JsonProperty('expiration', String, true)
	expiration: String = '';
}
@JsonObject('MsgGrant')
export class MsgGrant {
	@JsonProperty('granter', String, true)
	granter: String = '';
	@JsonProperty('grantee', [Coin], true)
	grantee: Coin[] = [];
	@JsonProperty('grant', Grant, true)
	grant: Grant = new Grant();
}
// @JsonObject('Body')
// Export class Body {
// 	@JsonProperty('memo', String, true)
// 	Memo: String = '';
// 	@JsonProperty('timeout_height', String, true)
// 	Timeout_height: String = '';
// 	@JsonProperty('extension_options', [String], true)
// 	Extension_options: String[] = [];
// 	@JsonProperty('non_critical_extension_options', [String], true)
// 	Non_critical_extension_options: String[] = [];
// }

// @JsonObject('AuthInfo')
// Export class AuthInfo {
// 	@JsonProperty('signed_infos', [String], true)
// 	Signed_infos: String[] = [];
// 	@JsonProperty('amount', [Coin], true)
// 	Amount: Coin[] = [];
// 	@JsonProperty('gas_limit', String, true)
// 	Gas_limit: string = '';
// 	@JsonProperty('payer', String, true)
// 	Payer: string = '';
// 	@JsonProperty('granter', String, true)
// 	Granter: string = '';
// }

// Export class Attribute {
// 	@JsonProperty('key', String)
// 	Key: string = '';
// 	@JsonProperty('value', String)
// 	Value: string = '';
// 	@JsonProperty('index', Boolean)
// 	Index: Boolean = false;
// }
export class TxResult {
	@JsonProperty('code', Number)
	code: Number = 0;
	@JsonProperty('data', String)
	data: String = '';
	@JsonProperty('log', String)
	log: String = '';
	@JsonProperty('info', String)
	info: String = '';
	@JsonProperty('gas_wanted', String)
	gas_wanted: String = '';
	@JsonProperty('gas_used', String)
	gas_used: String = '';
	@JsonProperty('events', [Attribute])
	events: Attribute[] = [];
	@JsonProperty('codespace', String)
	codespace: String = '';
}

@JsonObject('Transaction')
export class TransactionEntity implements ITransaction {
	@JsonProperty('_id', Object, true)
	public _id = Config.DB_TRANSACTION.dialect === 'local' ? Types.ObjectId() : null;

	@JsonProperty('tx', TxInput)
	tx: TxInput = {} as TxInput;
	@JsonProperty('tx_response', TxResponse)
	tx_response: TxResponse = {} as TxResponse;

	custom_info: CustomInfo = {} as CustomInfo;
	indexes: Object = {};
	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public getMongoEntity() {
		// eslint-disable-next-line no-underscore-dangle
		return { ...this, _id: this._id && this._id.toString() };
	}
}
