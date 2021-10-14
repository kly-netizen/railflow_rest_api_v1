"use strict";

const appConfig = require("../../configs/app");
const configs = appConfig.getConfigs();

const ApiError = require("../errors/api");
const mailgun = require("mailgun-js");
const logger = require("../config/logger");

/**
 * Service: Send email
 * @param {*} to Email to
 * @param {*} text Email content
 * @param {*} extraInfo Email extra info
 * @returns Promise
 */
async function sendEmail(to, text, extraInfo = {}) {
  const DOMAIN = "mail.railflow.io";
  const mg = mailgun({ apiKey: configs.MAILGUN_KEY, domain: DOMAIN });
  const data = {
    from: "Railflow Support <mail@railflow.io>",
    to,
    subject: "Railflow: Your license key is here.",
    ...extraInfo,
  };

  try {
    const body = await mg.messages().send(data);
    logger.info(`Email queued successfully to: ${to} | email_id: ${body.id}`);
    return {
      id: body.id,
    };
  } catch (error) {
    logger.error(`> error while sending email: ${error}`);
    throw new ApiError(`Error while sending onboarding email.`);
  }
}

module.exports = {
  sendEmail,
};
