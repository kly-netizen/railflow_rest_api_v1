'use strict';

const appConfig = require('../../configs/app');
const configs = appConfig.getConfigs(process.env.APP_ENV);
const { getApiClient } = require('../services/request');
const ApiError = require("../errors/api");
const invoiceService = require("./invoice");
const { v4: uuid } = require("uuid");

const RAILFLOW_GOLD_LICENSE = "Railflow - Gold License";
const RAILFLOW_SILVER_LICENSE = "Railflow - Silver License";

function capitalize(s)
{
    return s && s[0].toUpperCase() + s.slice(1);
}
async function create(data) {
    try {
        let price_option = 0
        if (data.num_users != null) {
            price_option = data.num_users / 20 >> 0;
        } 
        let price = 0;
        switch (data.license_type.toLowerCase()) {
            case "standard":
                price = 1500 + (300 * price_option);
                break;
            case "enterprise":
                price = 1800 + (400 * price_option);
                break;
            default:
                return {
                    error: {
                        message: "Incorrect value for license_type"
                    }
                };
        }
        const estimateData = {
            estimate: {
                connection_id: data.network.id,
                expire_date: "2022 -10-01",
                date: new Date(),
                // summary: `Railflow ${20*price_option}-${20*(price_option+1)}, ${data.license_years} Year License Quote`,
                summary: `Railflow ${data.license_type} Quote: ${data.license_years} Year License: ${20*price_option}-${20*(price_option+1)} Users`,
                note: `Custom item note`,
                // statement_no: uuid(),
                send_reminders: false,

                items_attributes: [{
                    date: new Date(),
                    description: `Railflow ${capitalize(data.license_type)} License \n ${20*price_option}-${20*(price_option+1)} TestRail Users \n License Term: ${data.license_years} Year`,
                    price: price,
                    quantity: data.license_years,
                    unit: "Year"
                }]
            }
        };

        const apiClient = await getApiClient(configs.HIVEAGE_BASE_URL);
        const response = await apiClient.request({
            method: 'POST',
            url: '/api/estm',
            headers: {
                // TODO: use environment variable
                'Content-Type': 'application/json',
            },
            data: estimateData,
            auth: {
                username: configs.HIVEAGE_API_KEY,
                password: ''
            }
        });

        console.log(`> estimate created successfully`);
        return response.data;
    } catch (error) {
        console.log(`> error:quote:service: ${error}`);
        throw new ApiError(`Error while creating estimate`);
    }
}

async function getRequiredItem(num_users) {
    // get all items
    let selectedPlan = "";

    if (num_users <= 15 && num_users > 0) {
        // silver. define in configs
        selectedPlan = RAILFLOW_SILVER_LICENSE;
    } else if (num_users > 15 && num_users < 25) {
        // gold. define in configs
        selectedPlan = RAILFLOW_GOLD_LICENSE;
    }

    console.log(`> selected plan; ${selectedPlan}`);

    const apiClient = await getApiClient(configs.HIVEAGE_BASE_URL);
    const response = await apiClient.request({
        method: 'GET',
        url: '/api/categories/items',
        headers: {
            // TODO: use environment variable
            'Content-Type': 'application/json',
        },
        auth: {
            username: configs.HIVEAGE_API_KEY,
            password: ''
        }
    });

    const { item_categories: itemCategories } = response.data;

    for (let item of itemCategories) {
        if (selectedPlan != "" && item.name === selectedPlan) {
            return item;
        }
    }

    return null;
}

module.exports = {
    create
};