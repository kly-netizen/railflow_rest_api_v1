'use strict';

const appConfig = require('../../configs/app');
const configs = appConfig.getConfigs(process.env.APP_ENV);

const ApiError = require("../errors/api");
const { getApiClient } = require('../services/request');
const accountService = require("./account");
const opportunityService = require('./opportunity');

/**
 * String format capitalize
 * @param {String} s Input string
 * @returns Capitalized string
 */
function capitalize(s)
{
    return s && s[0].toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Add day to input date
 * @param {*} theDate Input date
 * @param {*} days Number of days to be added
 * @returns New added days
 */
function addDays(theDate, days) {
    return new Date(theDate.getTime() + days*24*60*60*1000);
}

/**
 * Service: Create new Invoice Client
 * @param {*} data Input data
 * @returns Promise
 */
async function createInvoiceClient(data) {
    console.log(`> creating invoice for: ${JSON.stringify(data)}`);
        try {
            const apiClient = await getApiClient(configs.HIVEAGE_BASE_URL);
            const response = await apiClient.request({
                method: 'POST',
                url: '/api/network',
                headers: {
                    // TODO: use environment variable
                    'Content-Type': 'application/json',
                },
                data: data,
                auth: {
                    username: configs.HIVEAGE_API_KEY,
                    password: ''
                }
            });

            console.log(`> invoice client created for: ${data.name} | ${data.business_email}`);
            return response;
        } catch (error) {
            throw new ApiError(`Invoice client creation failed`);
        }
}

/**
 * Service: create new invoice based on the input data 
 * @param {*} data Input data
 * @returns Promise
 */
async function createInvoice(data) {
    try {
        let price_option = 0
        if (data.num_users != null) {
            price_option = data.num_users >> 0;
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
        let discount_percentage = 0;
        switch (parseInt(data.license_years)) {
            case 3:
                discount_percentage = 0.15;
                break;
            case 2:
                discount_percentage = 0.1;
                break;
            default:
                break;
        }
        let items_attributes = [];
        if (discount_percentage > 0) {
            items_attributes.push({
                date: new Date(),
                description: `Multi-Year Discount\n${data.license_years} Years = ${discount_percentage * 100}% Discount\n${discount_percentage * 100}% of $${price * data.license_years} = $${price * data.license_years * discount_percentage}`,
                price: -(price * data.license_years * discount_percentage),
                quantity: 1
            });
        }
        let license_term = `${data.license_years} Years`;
        if (data.license_years == 4) {
            license_term = `Perpetual (never expiring)`;
            items_attributes.push({
                date: new Date(),
                description: `Railflow ${capitalize(data.license_type)} License \n ${20*price_option}-${20*(price_option+1)} TestRail Users \n License Term: ${license_term}`,
                price: price * 4 * 0.83,
                quantity: 1,
                unit: "None"
            });
        } else {
            items_attributes.push({
                date: new Date(),
                description: `Railflow ${capitalize(data.license_type)} License \n ${20*price_option}-${20*(price_option+1)} TestRail Users \n License Term: ${license_term}`,
                price: price,
                quantity: data.license_years,
                unit: "Year"
            });
        }
        const invoiceData = {
            invoice: {
                connection_id: data.network.id,
                due_date: addDays(new Date(), 30),
                date: new Date(),
                // summary: `Railflow ${20*price_option}-${20*(price_option+1)}, ${data.license_years} Year License Invoice`,
                summary: `Railflow ${capitalize(data.license_type)} Invoice: ${license_term} License: ${20*price_option}-${20*(price_option+1)} Users`,
                note: `Custom item note`,
                send_reminders: false,

                items_attributes: items_attributes,
            }
        };

        const apiClient = await getApiClient(configs.HIVEAGE_BASE_URL);
        const invs_response = await apiClient.request({
            method: 'POST',
            url: '/api/invs',
            headers: {
                // TODO: use environment variable
                'Content-Type': 'application/json',
            },
            data: invoiceData,
            auth: {
                username: configs.HIVEAGE_API_KEY,
                password: ''
            }
        });

        console.log(`> invoice created successfully`);
        if (data.hiveage_contact_email == false) {
            const deliver_response = await apiClient.request({
                method: 'POST',
                url: `/api/invs/${invs_response.data.invoice.hash_key}/deliver`,
                headers: {
                    // TODO: use environment variable
                    'Content-Type': 'application/json',
                },
                auth: {
                    username: configs.HIVEAGE_API_KEY,
                    password: ''
                },
            });
            console.log('> invoice sent - default format');
        } else {
            const deliverEmailSubject = `Invoice ${invs_response.data.invoice.statement_no} Railflow ${capitalize(data.license_type)} ${license_term} License Quote ${20*price_option} - ${20*(price_option+1)} Users`;
            const deliverEmailContent = `\nHi ${data.user.display_name},
            \nA new invoice has been generated for you by Railflow Customer Support Team. Here's a quick summary:
            \nInvoice details: ${invs_response.data.invoice.statement_no} - Railflow ${capitalize(data.license_type)} Quote: ${license_term} License: ${20*price_option} - ${20*(price_option+1)} Users
            \nInvoice total: USD ${parseFloat(invs_response.data.invoice.billed_total).toLocaleString('en-US',2)}
            \n\nYou can view or download a PDF by going to: http://billing.railflow.io/invs/${invs_response.data.invoice.hash_key}
            \n\nBest regards,
            \nRailflow Customer Support Team.`;
            const deliver_response = await apiClient.request({
                method: 'POST',
                url: `/api/invs/${invs_response.data.invoice.hash_key}/deliver`,
                headers: {
                    // TODO: use environment variable
                    'Content-Type': 'application/json',
                },
                auth: {
                    username: configs.HIVEAGE_API_KEY,
                    password: ''
                },
                data: {
                    "delivery":{
                        "recipients":data.hiveage_contact_email,
                        "blind_copies":data.hiveage_notification_emails,
                        "subject":deliverEmailSubject,
                        "message":deliverEmailContent,
                        "attachment":true
                    }
                }
            });
            console.log('> invoice sent - custom format');
        }

        const fsOpportunityData = {
            deal : {
                name: `${data.account.name}: ${capitalize(data.license_type)}: ${license_term} License: ${20*price_option}-${20*(price_option+1)} Users`,
                amount: invs_response.data.invoice.billed_total, // created quote amount
                sales_account_id: data.account.id,
                expected_close: addDays(new Date(),30),
                deal_stage_id: 16000263411,
                custom_field: {
                    cf_contact_email: data.user.email,
                    cf_number_of_agents: `${20*price_option}-${20*(price_option+1)}`
                }
            }
        };
        
        let fsOpportunity = null;
        if (data.account.custom_field.cf_opportunity_id != null) {
            fsOpportunity = await opportunityService.getFsOpportunity(data.account.custom_field.cf_opportunity_id);
            if (!fsOpportunity || fsOpportunity.amount != fsOpportunityData.deal.amount) {
                fsOpportunity = await opportunityService.createFsOpportunity(fsOpportunityData);
                console.log(`> opportunity created under account: ${data.account.id}`);
                const updatedAccount = await accountService.update(data.account.id,{
                    sales_account: {
                        custom_field: {
                            cf_opportunity_id: `${fsOpportunity.id}`
                        }
                    }
                });
            }
            if (!fsOpportunity || fsOpportunity.amount == fsOpportunityData.deal.amount) {
                fsOpportunity = await opportunityService.updateFsOpportunity(fsOpportunity.id, {deal:{
                    deal_stage_id: 16000263411
                }});
                console.log(`> opportunity is moved to Invoice column`);
            }
        } else {
            fsOpportunity = await opportunityService.createFsOpportunity(fsOpportunityData);
            console.log(`> opportunity created under account: ${data.account.id}`);
            const updatedAccount = await accountService.update(data.account.id,{
                sales_account: {
                    custom_field: {
                        cf_opportunity_id: `${fsOpportunity.id}`
                    }
                }
            });
        }
        invs_response.data.fsOpportunity = fsOpportunity;
        return invs_response.data;
    } catch (error) {
        console.log(`> error:invoice:service: ${error}`);
        throw new ApiError(`Error while creating invoice`);
    }
}
module.exports = {
    createInvoice,
    createInvoiceClient
};