/**
 * User controller.
 * Contains all the business logic executed after
 * hitting any user endpoint in routes.
 */

"use strict";

const ApiError = require("../errors/api");
const UnprocessableRequestError = require("../errors/unprocessablerequest");

const fs = require('fs');
const Handlebars = require('handlebars');
const path = require('path');
const dayjs = require('dayjs');
const contactService = require('../services/contact');
const accountService = require('../services/account');
const slackService = require('../services/slack');
const licenseService = require('../services/license');
const emailService = require('../services/email');
const uploadService = require('../services/upload');
const noteService = require('../services/note');
const taskService = require('../services/task');
const { checkToken } = require('../services/token');

/**
 * Function: Create new Contact
 * @param {*} request Request body
 * @param {*} res Response
 * @param {*} next Next
 * @returns Promise
 */
async function createContact(request, res, next) {
  // Middleware: Check token beforehand
  const isAuthenticated = await checkToken(request.headers.token);
  if (!isAuthenticated) {
    return res.status(400).send({
      status: 400,
      message: 'token invalid or missing'
    });
  }

  try {
    const data = {
      firstName: request.body.firstName,
      lastName: request.body.lastName,
      email: request.body.email,
      phone: request.body.phone,
      jobTitle: request.body.jobTitle,
      company: request.body.company,
    };

    // check if the contact is already there.
    const alreadyPresent = await contactService.getContactIfAlreadyPresent(request.body.email);
    if (alreadyPresent !== null) {
      if (alreadyPresent.custom_field.cf_license_status == 'not_sent') {
        console.log('> contact with provided email already present but status is not_sent');
        return res.status(201).send({
          status: 201,
          data: {
            message: "contact created",
            contact_id: alreadyPresent.id,
            account_id: alreadyPresent.custom_field.cf_account_id,
            company_name: alreadyPresent.custom_field.cf_company
          },
        });
      }
      console.log(`> contact with provided email already present: ${request.body.email}`);
      return res.status(200).send({
        status: 200,
        data: {
          message: `Duplicate Registration`,
          contact_id: alreadyPresent.id,
          account_id: alreadyPresent.custom_field.cf_account_id
        },
      });
    }
    // Retrieve account/company
    let account = await accountService.getAccountIfAlreadyPresent(request.body.company);

    if (!account) {
      account = await accountService.create({ name: request.body.company });
    }

    if (!!account) {
      data.sales_accounts = [{
        id: account.id,
        is_primary: true,
      }];
      data.account_id = account.id;
      const response = await contactService.create(data);
      if (response && response.data && response.data.contact) {
        if (typeof(request.body.notify) == 'undefined' || request.body.notify) {
          const notificationData = {
            contactId: response.data.contact.id,
            company: request.body.company,
          };
          console.log(`> contact created. sending slack notification: ${response.data.contact.id}`);
          await slackService.sendMessage(notificationData);
        }
        return res.status(201).send({
          status: 201,
          data: {
            message: "contact created",
            contact_id: response.data.contact.id,
            account_id: account.id,
            company_name: response.data.contact.custom_field.cf_company
          },
        });
      }
    }

    return res.status(500).send({
      status: 500,
      data: {
        message: `Account creation failed with status code: ${resp.status} for: ${req.body.email}`,
      },
    });
  } catch (error) {
    if (error.message = 'BAD_REQUEST_MOBILE_NUMBER_EXISTS') {
      return res.status(200).send({
        status: 200,
        data: {
          message: "Duplicate Phone Number",
          phone: request.body.phone
        }
      });
    }
    return res.status(error.status).send(error.toJSON());
  }
}

/**
 * Function: update a Contact
 * @param {*} request Request
 * @param {*} res Response
 * @param {*} next Next
 * @returns Promise
 */
async function updateContact(request, res, next) {
  // Middleware: Check token beforehand
  const isAuthenticated = await checkToken(request.headers.token);
  if (!isAuthenticated) {
    return res.status(400).send({
      status: 400,
      message: 'token invalid or missing'
    });
  }
  
  try {
    const contact_id = request.body.contact_id;
    const contact = await contactService.getContactById(contact_id);
    if (!contact) {
      return res.status(200).send({
          status: 200,
          data: {
              message: `contact not found`,
          }
      });
    }
    const reqData = {
      contact_id: contact.id,
      contact_first_name: contact.first_name,
      contact_last_name: contact.last_name,
      contact_cf_company: contact.custom_field.cf_company,
      contact_email: contact.email,
    };
    // get or create sales account
    let account = await accountService.getAccountIfAlreadyPresent(reqData.contact_cf_company);
    if (!account) {
      account = await accountService.create({ name: reqData.contact_cf_company });
    }
    if (!!account) {
      const cryptolensTokenObject = await licenseService.getCryptolensToken(reqData);
      const mailgunResponse = await sendOnboardingEmail(reqData, cryptolensTokenObject);
      const mailgunEmailUrl = "https://app.mailgun.com/app/sending/domains/mail.railflow.io/logs/";
      const description = `License key: ${cryptolensTokenObject.key} \n\n Email sent at: ${dayjs()} \n\n Mailgun Id: ${mailgunEmailUrl}${mailgunResponse.emailData.id}/history`;
      const createNotesResponse = await noteService.create(reqData.contact_id, description);
      const createTaskResponse = await taskService.create({contact_id: reqData.contact_id});
      reqData.cf_license_key = cryptolensTokenObject.key;
      const patchedContact = await contactService.update(reqData);
  
      return res.status(200).send({
        status: 200,
        data: {
            message: `contact verified`,
            contact_id: patchedContact.id,
            account_id: patchedContact.custom_field.cf_account_id,
            first_name: patchedContact.first_name,
            last_name: patchedContact.last_name,
            address: patchedContact.address,
            city: patchedContact.city,
            state: patchedContact.state,
            zipcode: patchedContact.zipcode,
            country: patchedContact.country,
            license_key: patchedContact.custom_field.cf_license_key,
            license_link: mailgunResponse.licenseUrl,
            account_id: account.id,
            company_name: patchedContact.custom_field.cf_company,
            mailgun_url: `${mailgunEmailUrl}${mailgunResponse.emailData.id}/history`
        }
      });
    }
  } catch (error) {
    return res.status(500).send({
      status: 500,
      data: {
        message: `Contact not modified`,
        contact_id: request.body.contact_id
      },
    });
  }
}
// Todo: refactor this method because it is used in signup service.
function getCryptolensTokenEmailContent(cryptolensTokenObject) {
  return `Customer Id: ${cryptolensTokenObject.customerId} | Token: ${cryptolensTokenObject.key}`
}
async function getCryptolensFileUrl(cryptolensTokenObject) {
  try {
      const uploadRes = await uploadService.uploadToS3(cryptolensTokenObject);
      let text = ` You can also check out your license here: ${uploadRes.url}`;
      return {
          url: uploadRes.url,
          text
      };
  } catch (error) {
      throw new ApiError(`Error while uploading the file; ${error}`);
  }
}

// Todo: refactor this method because it is used in signup service.
async function sendOnboardingEmail(body, cryptolensTokenObject) {
    try {
        // collate all the data. pass it to general email service send.
        let text = getCryptolensTokenEmailContent(cryptolensTokenObject);
        const contactId = body.contact_id;

        cryptolensTokenObject.customerName = `${body.contact_first_name}_${body.contact_last_name}`;
        const { url: licenseUrl, text: cryptolensLicenseFileTextContent } = await getCryptolensFileUrl(cryptolensTokenObject);
        cryptolensTokenObject.url = licenseUrl;
        text += cryptolensLicenseFileTextContent;

        console.log(`> onboarding email text: ${text}`);

        const template = fs.readFileSync(path.join(__dirname, '../../email-templates/signup.hbs'), 'utf8');
        const compiled = Handlebars.compile(template);
        const templateData = {
            licenseKey: cryptolensTokenObject.key,
            licenseUrl: cryptolensTokenObject.url,
        };
        const html = compiled(templateData);
        const extraInfo = {
            "v:contactId": contactId,
            "o:tracking": 'yes',
            "o:tracking-clicks": 'yes',
            html,
        };

        const to = body.contact_email || "ali.raza@agiletestware.com";

        const emailData = await emailService.sendEmail(to, text, extraInfo);
        return {
            emailData: emailData,
            licenseUrl: licenseUrl
        };
    } catch (error) {
        throw new ApiError(`There was some issue sending email to: ${body.contact_id} ${error}`);
        return;
    }
}

module.exports = {
  createContact,
  updateContact
};
