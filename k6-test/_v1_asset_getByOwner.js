/*
 * Horoscope API Documentation
 * ## Indexer for multiple Cosmos Network   ### How to use  Select server Horoscope if use Horoscope API  Select server LCD if use Legacy API
 *
 * OpenAPI spec version: 1.0.0
 *
 * NOTE: This class is auto generated by OpenAPI Generator.
 * https://github.com/OpenAPITools/openapi-generator
 *
 * OpenAPI generator version: 6.1.0-SNAPSHOT
 */


import http from "k6/http";
import { group, check, sleep } from "k6";
import { randomItem, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';
// const BASE_URL = "https://indexer.dev.aurascan.io/api";
const BASE_URL = "https://indexer-test.dev.aurascan.io/api";
// Sleep duration between successive requests.
// You might want to edit the value of this variable or remove calls to the sleep function on the script.
const SLEEP_DURATION = 0.1;
// Global variables should be initialized.
// const CHAIN_ID = "euphoria-1"
const CHAIN_ID = "serenity-testnet-001"
const PAGE_LIMIT = "100"
const PAGE_OFFSET = "1"
const OPERATOR_ADDRESS = "euphoria-1"
const CONTRACT_TYPE = "CW721"
// const address = JSON.parse(open("./data/account_serenity.json"));
const address = JSON.parse(open("./data/account_has_cw721.json"));
const validator_status = JSON.parse(open("./data/validator_status.json"));
const module = JSON.parse(open("./data/module.json"));
const contractAddressList = JSON.parse(open("./data/contract.json"));
export const options = {
    // vus: 10,
    // iterations: 10,
    // stages: [
    //     // { target: 100, duration: '5s' },
    //     // { target: 150, duration: '10s' },
    //     // { target: 200, duration: '15s' },
    //     // { target: 250, duration: '20s' },
    //     // { target: 300, duration: '25s' },
    //     { target: 10000, duration: '300s' },
    //   ],
    scenarios: {
        constant_request_rate: {
            executor: 'constant-arrival-rate',
            rate: 10000,
            timeUnit: '1s', // 1000 iterations per second, i.e. 1000 RPS
            duration: '300s',
            preAllocatedVUs: 100, // how large the initial pool of VUs would be
            maxVUs: 2000, // if the preAllocatedVUs are not enough, we can initialize more
        },
    },
};

export default function () {
    group("/v1/asset/getByOwner", () => {
        let owner = randomItem(address); // 
        let tokenId = ''; // 
        let chainid = CHAIN_ID; // 
        let tokenName = ''; // 
        // let contractAddress = randomItem(contractAddressList); // 
        let contractAddress = ''; // 
        let countTotal = 'true'; // 
        let contractType = CONTRACT_TYPE; // 

        // Request No. 1
        {
            let url = BASE_URL + `/v1/asset/getByOwner?owner=${owner}&chainid=${chainid}`;
            if (tokenId != '') {
                url = url + `&tokenId=${tokenId}`;
            }
            if (tokenName != '') {
                url = url + `&tokenName=${tokenName}`;
            }
            if (contractAddress != '') {
                url = url + `&contractAddress=${contractAddress}`;
            }
            if (countTotal != '') {
                url = url + `&countTotal=${countTotal}`;
            }
            if (contractType != '') {
                url = url + `&contractType=${contractType}`;
            }
            let request = http.get(url);

            // check(request, {
            //     "OK": (r) => r.status === 200
            // });
            // console.log(owner,JSON.parse(request.body));
            // console.log(request);
            check(request, {
                // "Block result": (r) => r.status === 200,
                "Code result": (r) => JSON.parse(r.body).code === 200
            });
        }
    });
}
