/**
 * User controller.
 * Contains all the business logic executed after
 * hitting any user endpoint in routes.
 */

"use strict";

const ApiError = require("../errors/api");
const { getApiClient } = require('../services/request');

const emailService = require('../services/email');
const noteService = require('../services/note');
const licenseService = require('../services/license');
const contactService = require('../services/contact');
const { checkToken, checkTokenSlash } = require('../services/token');

/**
 * Function: Extend License base on contact_cf_extension_period in the body
 * @param {*} req Request
 * @param {*} res Response
 * @param {*} next Next
 * @returns Promise
 */
async function extendLicense(req, res, next) {
  // Middleware: Check token beforehand
  const isAuthenticated = await checkToken(req.headers.token);
  if (!isAuthenticated) {
    return res.status(400).send({
      status: 400,
      message: 'token invalid or missing'
    });
  }

  try {
    const license = await licenseService.extend(req.body);
    const description = `License has been extended by ${req.body.contact_cf_extension_period} days`;
    const createNotesResponse = await noteService.create(req.body.contact_id, description);
    await sendLicenseExtensionEmail(req.body, `Your license has been extended by ${req.body.contact_cf_extension_period} days.`);

    return res.status(200).send({
      status: 200,
      data: {
        message: `license extended successfully for the contact: ${req.body.contact_id}`,
      }
    });
  } catch (error) {
    console.log(`> error while extending license for: ${req.body.contact_id}: ${error}`);
    return res.status(error.status).send(error.toJSON());
  }
}

/**
 * Function: Extend License base on contact_cf_extension_period in the body
 * @param {*} req Request
 * @param {*} res Response
 * @param {*} next Next
 * @returns Promise
 */
async function extendLicenseSlack(req, res, next) {
  const isAuthenticated = await checkTokenSlash(req.body.token);
  if (!isAuthenticated) {
    return res.status(400).send({
      status: 400,
      message: 'token invalid or missing'
    });
  }
  const vars = req.body.text.split(" ");
  vars.forEach(item => {
    const itemsplited = item.split(":");
    req.body[itemsplited[0]] = itemsplited[1];
  });
  if (typeof req.body.license_key !== 'undefined') {
    req.body.contact_cf_license_key = req.body.license_key;
  } else {
    return res.json({
      "response_type": "in_channel", // public to the channel
      "text": "License Key is invalid, please follow this example (periods 0-36 months, Zero is default to 14 days): `periods:8 license_key:ICWUF-JHARN-GEGRI-XDMYN`"
    });
  }
  if (parseInt(req.body.periods)) {
    req.body.contact_cf_extension_period = parseInt(req.body.periods);
  }
  else {
    return res.json({
      "response_type": "in_channel", // public to the channel
      "text": "Period is invalid, please follow this example (periods 0-36 months, Zero is default to 14 days): `periods:8 license_key:ICWUF-JHARN-GEGRI-XDMYN`"
    });
  }
  const apiClient = await getApiClient(req.body.response_url);
  try {
    // Return HTTP 200 to Slack
    res.json({
      "response_type": "in_channel", // public to the channel
      "text": "Extending the license..."
    });
    const license = await licenseService.extend(req.body);
    let licensePeriods = 14;
    if (req.body.contact_cf_extension_period > 0) {
      licensePeriods = 30 * req.body.contact_cf_extension_period;
    }
    console.log(licensePeriods);
    await apiClient.request({
      method: 'POST',
      data: {
        "response_type": "in_channel", // public to the channel
        text: `Extended the license for ${licensePeriods} days`
      }
    });
  } catch (error) {
    console.log(`> error while extending license for: ${req.body.contact_id}: ${error}`);
    return res.status(error.status).send(error.toJSON());
  }
}
/**
 * Protected Function: Send the license email after extended
 * @param {*} body Body
 * @param {*} text Text
 * @returns Promise
 */
async function sendLicenseExtensionEmail(body, text) {
  try {
    // collate all the data. pass it to general email service send.

    const contactId = body.contact_id;
    const html = `<p>${text}</p>`;
    const extraInfo = {
      "v:contactId": contactId,
      html
    };

    const to = body.contact_email || "railflowio@yopmail.com";
    const emailData = await emailService.sendEmail(to, text, extraInfo);
    return emailData;
  } catch (error) {
    console.log(`> error: ${error}`);
    throw new ApiError(`There was some issue sending email to: ${body.contact_id}`);
  }
}

module.exports = {
  extendLicense,
  extendLicenseSlack
};
