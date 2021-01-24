'use strict';

const appConfig = require('../../configs/app');
const configs = appConfig.getConfigs(process.env.APP_ENV);
const { getApiClient } = require('../services/request');

async function sendMessage(data) {
    try {
        const apiClient = await getApiClient(configs.SLACK_API_BASE_URL);
        await apiClient.request({
          method: 'POST',
          data: {
            text: `New lead sign up: ${data.company}: https://railflow.myfreshworks.com/crm/sales/contacts/${data.contactId}`,
          },
        });

        return Promise.resolve();
      } catch (error) {
        console.log(error);
        throw new ApiError(`> Error while sending slack message`);
      }
}

module.exports = {
    sendMessage
};