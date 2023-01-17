'use strict';

import { ServiceBroker } from 'moleculer';
import { Config } from '../../../../common';
import { CONST_CHAR } from '../../../../common/constant';
import HandleAddressService from '../../../../services/crawl-account-info/handle-address.service';
import CrawlAccountUnbondsService from '../../../../services/crawl-account-info/crawl-account-unbonds.service';
import DelayJobService from '../../../../services/crawl-account-info/delay-job.service';
import { callApiUnbond, txUndelegate } from './mock-data';
import _ from 'lodash';

Config.TEST = true;

describe('Test crawl-account-unbonds service', () => {
    jest.setTimeout(30000);

    const broker = new ServiceBroker({ logger: false });
    const handleAddressService = broker.createService(HandleAddressService);
    const crawlAccountUnbondsService = broker.createService(CrawlAccountUnbondsService);

    const delayJobService = broker.createService(DelayJobService);

    const mockCallApi = jest.fn(() => Promise.resolve(callApiUnbond));

    // Start the broker. It will also init the service
    beforeAll(async () => {
        await broker.start();
        await crawlAccountUnbondsService.waitForServices(['v1.delay-job']);
        await crawlAccountUnbondsService.getQueue('crawl.account-unbonds').empty();
        await handleAddressService.handleJob([txUndelegate], CONST_CHAR.CRAWL, Config.CHAIN_ID);
    });
    // Gracefully stop the broker after all tests
    afterAll(async () => {
        await crawlAccountUnbondsService.adapter.removeMany({});
        await delayJobService.adapter.removeMany({});
        await broker.stop();
    });

    it('Should update account_unbonding', async () => {
        crawlAccountUnbondsService.callApiFromDomain = mockCallApi;

        await crawlAccountUnbondsService.handleJob(
            ['aura1t0l7tjhqvspw7lnsdr9l5t8fyqpuu3jm57ezqa'],
            Config.CHAIN_ID
        );

        let [resultAccount, resultDelayJob] = await Promise.all([
            crawlAccountUnbondsService.adapter.findOne({
                address: 'aura1t0l7tjhqvspw7lnsdr9l5t8fyqpuu3jm57ezqa'
            }),
            delayJobService.adapter.find({})
        ]);

        expect(resultAccount.account_unbonding.length).toEqual(1);
        expect(resultDelayJob.length).toEqual(1);
    });
});