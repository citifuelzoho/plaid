const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
});

// TEMPORARY DIAGNOSTIC LOGGING
// Confirms exactly which .env file this process loaded at
// startup. Remove once the invalid_client issue is resolved.
console.log(
  "Loaded .env from:",
  path.join(__dirname, "..", ".env")
);

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const {
  PlaidApi,
  Configuration,
  PlaidEnvironments,
} = require("plaid");

const app = express();

/* =========================================================
   GENERAL CONFIGURATION
========================================================= */

const PORT = Number(process.env.PORT || 5009);

const publicPath = path.join(
  __dirname,
  "..",
  "public"
);

app.use(cors());
app.use(express.json());
app.use(
  express.urlencoded({
    extended: true,
  })
);

app.use(express.static(publicPath));

/* =========================================================
   PLAID CONFIGURATION
========================================================= */

const plaidEnv = String(
  process.env.PLAID_ENV || "sandbox"
)
  .trim()
  .toLowerCase();

const plaidClientId = String(
  process.env.PLAID_CLIENT_ID || ""
).trim();

const plaidSecret = String(
  process.env.PLAID_SECRET || ""
).trim();

const plaidTemplateId = String(
  process.env.PLAID_IDV_TEMPLATE_ID || ""
).trim();

if (!PlaidEnvironments[plaidEnv]) {
  throw new Error(
    `Invalid PLAID_ENV: ${plaidEnv}. Use sandbox, development, or production.`
  );
}

if (!plaidClientId) {
  throw new Error(
    "PLAID_CLIENT_ID is missing in .env"
  );
}

if (!plaidSecret) {
  throw new Error(
    "PLAID_SECRET is missing in .env"
  );
}

if (!plaidTemplateId) {
  throw new Error(
    "PLAID_IDV_TEMPLATE_ID is missing in .env"
  );
}

const plaidClient = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[plaidEnv],

    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": plaidClientId,
        "PLAID-SECRET": plaidSecret,
      },
    },
  })
);

/* =========================================================
   ZOHO CONFIGURATION
========================================================= */

const zohoClientId = String(
  process.env.ZOHO_CLIENT_ID || ""
).trim();

const zohoClientSecret = String(
  process.env.ZOHO_CLIENT_SECRET || ""
).trim();

const zohoRefreshToken = String(
  process.env.ZOHO_REFRESH_TOKEN || ""
).trim();

const zohoAccountsUrl = String(
  process.env.ZOHO_ACCOUNTS_URL ||
    "https://accounts.zoho.com"
)
  .trim()
  .replace(/\/$/, "");

const zohoApiUrl = String(
  process.env.ZOHO_API_URL ||
    "https://www.zohoapis.com"
)
  .trim()
  .replace(/\/$/, "");

const zohoLeadsModule = String(
  process.env.ZOHO_LEADS_MODULE ||
    "Leads"
).trim();

/* =========================================================
   ZOHO FIELD API NAMES
========================================================= */

const zohoPlaidTokenField = String(
  process.env.ZOHO_PLAID_TOKEN_FIELD ||
    "Plaid_Token"
).trim();

const zohoLeadStatusField = String(
  process.env.ZOHO_LEAD_STATUS_FIELD ||
    "Lead_Status"
).trim();

const zohoAllowedLeadStatus = String(
  process.env.ZOHO_ALLOWED_LEAD_STATUS ||
    "App Sent,Application Filled"
)
  .split(",")
  .map((status) => status.trim())
  .filter(Boolean);

const zohoTokenStatusField = String(
  process.env.ZOHO_TOKEN_STATUS_FIELD ||
    "Plaid_Token_Status"
).trim();

const zohoTokenUsedField = String(
  process.env.ZOHO_TOKEN_USED_FIELD ||
    "Plaid_Token_Used_Time"
).trim();

const zohoPlaidStageField = String(
  process.env.ZOHO_PLAID_STAGE_FIELD ||
    "Plaid_Stage"
).trim();

const zohoFuelCardNameField = String(
  process.env.ZOHO_FUEL_CARD_NAME_FIELD ||
    "Fuel_Card_Name"
).trim();

/*
 * Gates whether the Agreement step applies at all: Cardless ->
 * Agreement is required; Physical -> no Agreement, straight to
 * Completed after Plaid. Independent of Fuel_Card_Name/isVeon,
 * which only picks which form VARIANT (Veon vs default) is
 * shown for the Application and, when it applies, Agreement.
 */
const zohoFulfillmentTypeField = String(
  process.env.ZOHO_FULFILLMENT_TYPE_FIELD ||
    "Fulfillment_Type"
).trim();

/* =========================================================
   ZOHO FORM URLS FROM .ENV
========================================================= */

const zohoFormUrl = String(
  process.env.ZOHO_FORM_URL || ""
).trim();

const zohoFormVeonUrl = String(
  process.env.ZOHO_FORM_VEON_URL || ""
).trim();

/*
 * AGREEMENT FORM URLS
 * Whether Agreement applies at all is gated by Fulfillment_Type
 * (Cardless -> Agreement required; Physical -> skipped, straight
 * to Completed after Plaid). Fuel_Card_Name / isVeon is
 * unrelated to that gate — it only picks which form VARIANT is
 * shown once we already know Agreement applies:
 *   Cardless + Veon     -> zohoAgreementFormVeonUrl
 *   Cardless + non-Veon -> zohoAgreementFormUrl
 *   Physical (either)   -> no Agreement form used at all
 */
const zohoAgreementFormUrl = String(
  process.env.ZOHO_AGREEMENT_FORM_URL || ""
).trim();

const zohoAgreementFormVeonUrl = String(
  process.env.ZOHO_AGREEMENT_FORM_VEON_URL || ""
).trim();

/* =========================================================
   TOKEN STATUS VALUES
========================================================= */

const TOKEN_STATUS_ACTIVE = "Active";
const TOKEN_STATUS_USED = "Used";
const TOKEN_STATUS_EXPIRED = "Expired";
const TOKEN_STATUS_REVOKED = "Revoked";

/* =========================================================
   PLAID STAGE VALUES
========================================================= */

const PLAID_STAGE_ZOHO_FORM = String(
  process.env.ZOHO_STAGE_ZOHO_FORM ||
    "Zoho form"
).trim();

const PLAID_STAGE_VERIFICATION = String(
  process.env.ZOHO_STAGE_VERIFICATION ||
    "Plaid verification"
).trim();

/*
 * Agreement stage, sits between Plaid verification and
 * Completed. Only reached by Cardless leads (see
 * Fulfillment_Type below) — Physical leads skip it entirely.
 */
const PLAID_STAGE_AGREEMENT = String(
  process.env.ZOHO_STAGE_AGREEMENT ||
    "Agreement"
).trim();

const PLAID_STAGE_COMPLETED = String(
  process.env.ZOHO_STAGE_COMPLETED ||
    "Completed"
).trim();

/* =========================================================
   REQUIRED ENV VALIDATION
========================================================= */

if (!zohoClientId) {
  throw new Error(
    "ZOHO_CLIENT_ID is missing in .env"
  );
}

if (!zohoClientSecret) {
  throw new Error(
    "ZOHO_CLIENT_SECRET is missing in .env"
  );
}

if (!zohoRefreshToken) {
  throw new Error(
    "ZOHO_REFRESH_TOKEN is missing in .env"
  );
}

if (!zohoFormUrl) {
  throw new Error(
    "ZOHO_FORM_URL is missing in .env"
  );
}

if (!zohoFormVeonUrl) {
  throw new Error(
    "ZOHO_FORM_VEON_URL is missing in .env"
  );
}

if (!zohoAgreementFormUrl) {
  throw new Error(
    "ZOHO_AGREEMENT_FORM_URL is missing in .env"
  );
}

if (!zohoAgreementFormVeonUrl) {
  throw new Error(
    "ZOHO_AGREEMENT_FORM_VEON_URL is missing in .env"
  );
}

try {
  new URL(zohoFormUrl);
} catch (error) {
  throw new Error(
    "ZOHO_FORM_URL is not a valid URL"
  );
}

try {
  new URL(zohoFormVeonUrl);
} catch (error) {
  throw new Error(
    "ZOHO_FORM_VEON_URL is not a valid URL"
  );
}

try {
  new URL(zohoAgreementFormUrl);
} catch (error) {
  throw new Error(
    "ZOHO_AGREEMENT_FORM_URL is not a valid URL"
  );
}

try {
  new URL(zohoAgreementFormVeonUrl);
} catch (error) {
  throw new Error(
    "ZOHO_AGREEMENT_FORM_VEON_URL is not a valid URL"
  );
}

/* =========================================================
   ENVIRONMENT LOG
========================================================= */

console.log("========== ENV CHECK ==========");
console.log("PORT:", PORT);
console.log("PLAID_ENV:", plaidEnv);

console.log(
  "PLAID_CLIENT_ID exists:",
  Boolean(plaidClientId)
);

console.log(
  "PLAID_SECRET exists:",
  Boolean(plaidSecret)
);

console.log(
  "PLAID_IDV_TEMPLATE_ID exists:",
  Boolean(plaidTemplateId)
);

console.log(
  "ZOHO_CLIENT_ID exists:",
  Boolean(zohoClientId)
);

console.log(
  "ZOHO_CLIENT_SECRET exists:",
  Boolean(zohoClientSecret)
);

console.log(
  "ZOHO_REFRESH_TOKEN exists:",
  Boolean(zohoRefreshToken)
);

console.log(
  "ZOHO_ACCOUNTS_URL:",
  zohoAccountsUrl
);

console.log(
  "ZOHO_API_URL:",
  zohoApiUrl
);

console.log(
  "ZOHO_LEADS_MODULE:",
  zohoLeadsModule
);

console.log(
  "ZOHO_PLAID_TOKEN_FIELD:",
  zohoPlaidTokenField
);

console.log(
  "ZOHO_LEAD_STATUS_FIELD:",
  zohoLeadStatusField
);

console.log(
  "ZOHO_ALLOWED_LEAD_STATUS:",
  zohoAllowedLeadStatus.join(", ")
);

console.log(
  "ZOHO_TOKEN_STATUS_FIELD:",
  zohoTokenStatusField
);

console.log(
  "ZOHO_TOKEN_USED_FIELD:",
  zohoTokenUsedField
);

console.log(
  "ZOHO_PLAID_STAGE_FIELD:",
  zohoPlaidStageField
);

console.log(
  "ZOHO_FUEL_CARD_NAME_FIELD:",
  zohoFuelCardNameField
);

console.log(
  "ZOHO_FULFILLMENT_TYPE_FIELD:",
  zohoFulfillmentTypeField
);

console.log(
  "ZOHO_FORM_URL exists:",
  Boolean(zohoFormUrl)
);

console.log(
  "ZOHO_FORM_VEON_URL exists:",
  Boolean(zohoFormVeonUrl)
);

console.log(
  "ZOHO_AGREEMENT_FORM_URL exists:",
  Boolean(zohoAgreementFormUrl)
);

console.log(
  "ZOHO_AGREEMENT_FORM_VEON_URL exists:",
  Boolean(zohoAgreementFormVeonUrl)
);

console.log(
  "ZOHO_STAGE_ZOHO_FORM:",
  PLAID_STAGE_ZOHO_FORM
);

console.log(
  "ZOHO_STAGE_VERIFICATION:",
  PLAID_STAGE_VERIFICATION
);

console.log(
  "ZOHO_STAGE_AGREEMENT:",
  PLAID_STAGE_AGREEMENT
);

console.log(
  "ZOHO_STAGE_COMPLETED:",
  PLAID_STAGE_COMPLETED
);

console.log("================================");

/* =========================================================
   ZOHO ACCESS TOKEN CACHE
   (includes an in-flight refresh lock to prevent multiple
   concurrent requests from each triggering their own
   Zoho OAuth refresh call, which can trip Zoho's
   "too many requests continuously" rate limit)
========================================================= */

let cachedZohoAccessToken = null;
let zohoAccessTokenExpiresAt = 0;
let inFlightZohoRefresh = null;

async function getZohoAccessToken() {
  const currentTime = Date.now();

  const tokenIsStillValid =
    cachedZohoAccessToken &&
    currentTime <
      zohoAccessTokenExpiresAt -
        5 * 60 * 1000;

  if (tokenIsStillValid) {
    return cachedZohoAccessToken;
  }

  // If a refresh is already in progress, reuse it instead of
  // firing a second concurrent request to Zoho.
  if (inFlightZohoRefresh) {
    console.log(
      "Reusing in-flight Zoho token refresh (avoided duplicate call)"
    );

    return inFlightZohoRefresh;
  }

  inFlightZohoRefresh = (async () => {
    try {
      console.log(
        "\n========== ZOHO ACCESS TOKEN REFRESH =========="
      );

      // TEMPORARY DIAGNOSTIC LOGGING
      // Confirms the running process is actually using the
      // credential values you expect. Remove once the
      // invalid_client issue is resolved.
      console.log(
        "Refresh request client_id:",
        zohoClientId
      );

      console.log(
        "Refresh request secret length:",
        zohoClientSecret.length
      );

      console.log(
        "Refresh request refresh_token length:",
        zohoRefreshToken.length
      );

      console.log(
        "Refresh request accounts URL:",
        zohoAccountsUrl
      );

      const requestBody =
        new URLSearchParams({
          refresh_token: zohoRefreshToken,
          client_id: zohoClientId,
          client_secret: zohoClientSecret,
          grant_type: "refresh_token",
        }).toString();

      const response = await axios.post(
        `${zohoAccountsUrl}/oauth/v2/token`,
        requestBody,
        {
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
          },

          timeout: 15000,

          validateStatus() {
            return true;
          },
        }
      );

      console.log(
        "Zoho OAuth HTTP status:",
        response.status
      );

      if (
        response.status < 200 ||
        response.status >= 300 ||
        !response.data?.access_token
      ) {
        console.error(
          "Zoho OAuth response:",
          response.data
        );

        throw new Error(
          `Zoho access token was not returned: ${JSON.stringify(
            response.data
          )}`
        );
      }

      cachedZohoAccessToken =
        response.data.access_token;

      const expiresInSeconds = Number(
        response.data.expires_in || 3600
      );

      zohoAccessTokenExpiresAt =
        Date.now() +
        expiresInSeconds * 1000;

      console.log(
        "Zoho access token refreshed successfully"
      );

      console.log(
        "Expires in:",
        expiresInSeconds,
        "seconds"
      );

      console.log(
        "===============================================\n"
      );

      return cachedZohoAccessToken;
    } finally {
      // Clear the lock whether the refresh succeeded or failed,
      // so the next call is free to try again.
      inFlightZohoRefresh = null;
    }
  })();

  return inFlightZohoRefresh;
}

/* =========================================================
   HELPER FUNCTIONS
========================================================= */

function normalizeCrmToken(value) {
  const token = String(value || "")
    .trim()
    .toLowerCase();

  const uuidV4Pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidV4Pattern.test(token)) {
    return null;
  }

  return token;
}

function maskToken(value) {
  const token = String(value || "");

  if (token.length < 12) {
    return "***";
  }

  return (
    token.substring(0, 8) +
    "..." +
    token.substring(token.length - 4)
  );
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function extractStringValue(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (typeof value.name === "string") {
      return value.name;
    }

    if (typeof value.display_value === "string") {
      return value.display_value;
    }

    if (typeof value.value === "string") {
      return value.value;
    }

    return JSON.stringify(value);
  }

  return String(value);
}

function normalizePlaidStage(value) {
  return normalizeText(value);
}

function normalizeFuelCardName(value) {
  return normalizeText(extractStringValue(value));
}

function formatZohoDateTime(
  date = new Date()
) {
  const pad = (value, width = 2) =>
    String(value).padStart(width, "0");

  const year = date.getUTCFullYear();
  const month = pad(
    date.getUTCMonth() + 1
  );
  const day = pad(
    date.getUTCDate()
  );
  const hours = pad(
    date.getUTCHours()
  );
  const minutes = pad(
    date.getUTCMinutes()
  );
  const seconds = pad(
    date.getUTCSeconds()
  );

  /*
   * Zoho CRM API DateTime maydonlari
   * "Z" (Zulu) formatini emas, balki
   * aniq timezone offset (+00:00)
   * formatini kutadi, va millisekund
   * bo'lmasligi kerak. JS'ning
   * date.toISOString() esa
   * "2026-07-15T14:33:35.834Z" kabi
   * qaytaradi — bu Zoho tomonidan
   * ba'zan INVALID_DATA sifatida rad
   * etiladi. Shu sabab qo'lda to'g'ri
   * formatga o'giramiz:
   * "2026-07-15T14:33:35+00:00"
   */
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+00:00`;
}

/* =========================================================
   FUEL CARD NAME FORM ROUTING
========================================================= */

function isVeonFuelCardName(fuelCardName) {
  return normalizeFuelCardName(fuelCardName).includes("veon");
}

function getFormConfigForFuelCardName(fuelCardName) {
  const isVeon = isVeonFuelCardName(fuelCardName);

  return {
    formType: isVeon ? "veon" : "default",
    formUrl: isVeon ? zohoFormVeonUrl : zohoFormUrl,
  };
}

/*
 * Whether Agreement applies at all is gated by Fulfillment_Type
 * (see isCardlessFulfillmentType below), NOT by Fuel_Card_Name.
 * This helper should only be called once we already know
 * Agreement applies (i.e. Fulfillment_Type is Cardless) — it
 * just picks which form VARIANT to show, same isVeon pattern
 * as the Application form.
 */
function isCardlessFulfillmentType(fulfillmentType) {
  return normalizeText(fulfillmentType).includes(
    "cardless"
  );
}

function getAgreementFormConfigForFuelCardName(fuelCardName) {
  const isVeon = isVeonFuelCardName(fuelCardName);

  return {
    formType: isVeon ? "veon" : "default",
    formUrl: isVeon
      ? zohoAgreementFormVeonUrl
      : zohoAgreementFormUrl,
  };
}

/* =========================================================
   UPDATE LEAD IN ZOHO CRM
========================================================= */

async function updateLeadFields(
  leadId,
  fields
) {
  console.log(
    "\n========== UPDATE ZOHO LEAD =========="
  );

  console.log("Lead ID:", leadId);
  console.log("Fields:", fields);

  const accessToken =
    await getZohoAccessToken();

  const response = await axios.put(
    `${zohoApiUrl}/crm/v8/${zohoLeadsModule}`,
    {
      data: [
        {
          id: String(leadId),
          ...fields,
        },
      ],
    },
    {
      headers: {
        Authorization:
          `Zoho-oauthtoken ${accessToken}`,

        "Content-Type":
          "application/json",
      },

      timeout: 15000,

      validateStatus() {
        return true;
      },
    }
  );

  console.log(
    "Zoho update HTTP status:",
    response.status
  );

  console.log(
    "Zoho update response:",
    JSON.stringify(
      response.data,
      null,
      2
    )
  );

  if (
    response.status < 200 ||
    response.status >= 300
  ) {
    throw new Error(
      `Zoho Lead update failed: ${JSON.stringify(
        response.data
      )}`
    );
  }

  const result =
    response.data?.data?.[0];

  if (
    !result ||
    result.status !== "success"
  ) {
    throw new Error(
      `Zoho Lead update rejected: ${JSON.stringify(
        result || response.data
      )}`
    );
  }

  console.log(
    "Zoho Lead updated successfully"
  );

  console.log(
    "======================================\n"
  );

  return response.data;
}

async function updateLeadFieldsBestEffort(
  leadId,
  fields,
  context
) {
  try {
    await updateLeadFields(
      leadId,
      fields
    );

    return true;
  } catch (error) {
    console.error(
      `Best-effort CRM update failed: ${context}`
    );

    console.error(
      "Lead ID:",
      leadId
    );

    console.error(
      "Error:",
      error.message
    );

    return false;
  }
}

/* =========================================================
   VALIDATE TOKEN USING ZOHO COQL
========================================================= */

async function validateLeadToken(
  rawToken
) {
  console.log(
    "\n========== CRM TOKEN VALIDATION START =========="
  );

  console.log(
    "Timestamp:",
    new Date().toISOString()
  );

  console.log(
    "Raw token received:",
    maskToken(rawToken)
  );

  const crmToken =
    normalizeCrmToken(rawToken);

  if (!crmToken) {
    console.log(
      "VALIDATION RESULT: INVALID TOKEN FORMAT"
    );

    return {
      valid: false,
      statusCode: 400,
      message:
        "Invalid verification token format",
    };
  }

  const accessToken =
    await getZohoAccessToken();

  const escapedToken =
    crmToken.replace(/'/g, "\\'");

  const selectQuery = `
    SELECT
      id,
      First_Name,
      Last_Name,
      Email,
      ${zohoPlaidTokenField},
      ${zohoLeadStatusField},
      ${zohoTokenStatusField},
      ${zohoTokenUsedField},
      ${zohoPlaidStageField},
      ${zohoFuelCardNameField},
      ${zohoFulfillmentTypeField}
    FROM ${zohoLeadsModule}
    WHERE ${zohoPlaidTokenField} = '${escapedToken}'
    LIMIT 2
  `
    .replace(/\s+/g, " ")
    .trim();

  console.log(
    "Zoho COQL URL:",
    `${zohoApiUrl}/crm/v8/coql`
  );

  console.log(
    "Zoho COQL query:",
    selectQuery
  );

  const response = await axios.post(
    `${zohoApiUrl}/crm/v8/coql`,
    {
      select_query: selectQuery,
    },
    {
      headers: {
        Authorization:
          `Zoho-oauthtoken ${accessToken}`,

        "Content-Type":
          "application/json",
      },

      timeout: 15000,

      validateStatus() {
        return true;
      },
    }
  );

  console.log(
    "Zoho COQL HTTP status:",
    response.status
  );

  console.log(
    "Zoho COQL response:",
    JSON.stringify(
      response.data,
      null,
      2
    )
  );

  if (
    response.status < 200 ||
    response.status >= 300
  ) {
    throw new Error(
      `Zoho COQL failed: ${JSON.stringify(
        response.data
      )}`
    );
  }

  const leads =
    Array.isArray(response.data?.data)
      ? response.data.data
      : [];

  console.log(
    "Matching Lead count:",
    leads.length
  );

  if (leads.length === 0) {
    console.log(
      "VALIDATION RESULT: TOKEN NOT FOUND"
    );

    return {
      valid: false,
      statusCode: 403,
      message:
        "Verification token was not found",
    };
  }

  if (leads.length > 1) {
    console.log(
      "VALIDATION RESULT: DUPLICATE TOKEN"
    );

    console.log(
      "Duplicate Lead IDs:",
      leads.map((lead) => lead.id)
    );

    return {
      valid: false,
      statusCode: 409,
      message:
        "Duplicate verification token found",
    };
  }

  const lead = leads[0];

  console.log(
    "Matching Lead found"
  );

  console.log(
    "Lead ID:",
    lead.id
  );

  console.log(
    "Lead name:",
    `${lead.First_Name || ""} ${
      lead.Last_Name || ""
    }`.trim()
  );

  console.log(
    "Lead email:",
    lead.Email || ""
  );

  console.log(
    "CRM saved token:",
    maskToken(
      lead[zohoPlaidTokenField]
    )
  );

  console.log(
    "CRM Lead Status:",
    lead[zohoLeadStatusField]
  );

  console.log(
    "CRM Token Status:",
    lead[zohoTokenStatusField]
  );

  console.log(
    "CRM Plaid Stage:",
    lead[zohoPlaidStageField]
  );

  console.log(
    "CRM Fuel Card Name:",
    extractStringValue(lead[zohoFuelCardNameField]) ||
      JSON.stringify(lead[zohoFuelCardNameField])
  );

  console.log(
    "CRM Fulfillment Type:",
    extractStringValue(lead[zohoFulfillmentTypeField]) ||
      JSON.stringify(lead[zohoFulfillmentTypeField])
  );

  const savedToken = String(
    lead[zohoPlaidTokenField] || ""
  )
    .trim()
    .toLowerCase();

  if (savedToken !== crmToken) {
    console.log(
      "VALIDATION RESULT: TOKEN DOES NOT MATCH"
    );

    return {
      valid: false,
      statusCode: 403,
      message:
        "Verification token is invalid",
    };
  }

  const currentLeadStatus =
    String(
      lead[zohoLeadStatusField] ||
        ""
    ).trim();

  const normalizedAllowedStatuses =
  zohoAllowedLeadStatus.map((status) =>
    normalizeText(status)
  );

if (
  !normalizedAllowedStatuses.includes(
    normalizeText(currentLeadStatus)
  )
) {
  console.log(
    "VALIDATION RESULT: LEAD STATUS NOT ALLOWED"
  );

  console.log(
    "Current Lead Status:",
    currentLeadStatus
  );

  console.log(
    "Required Lead Status:",
    zohoAllowedLeadStatus.join(", ")
  );

  return {
    valid: false,
    statusCode: 403,
    message:
      "This verification link is no longer active",
  };
}

  const tokenStatus = String(
    lead[zohoTokenStatusField] || ""
  ).trim();

  console.log(
    "Token Status:",
    tokenStatus || "(empty)"
  );

  if (
    normalizeText(tokenStatus) !==
    normalizeText(
      TOKEN_STATUS_ACTIVE
    )
  ) {
    let message =
      "This verification link is not active";

    const normalizedTokenStatus =
      normalizeText(tokenStatus);

    if (
      normalizedTokenStatus ===
      normalizeText(
        TOKEN_STATUS_USED
      )
    ) {
      message =
        "This verification link has already been used";
    } else if (
      normalizedTokenStatus ===
      normalizeText(
        TOKEN_STATUS_EXPIRED
      )
    ) {
      message =
        "This verification link has expired";
    } else if (
      normalizedTokenStatus ===
      normalizeText(
        TOKEN_STATUS_REVOKED
      )
    ) {
      message =
        "This verification link has been revoked";
    }

    console.log(
      "VALIDATION RESULT: TOKEN IS NOT ACTIVE"
    );

    console.log(
      "Validation message:",
      message
    );

    return {
      valid: false,
      statusCode: 403,
      message,
    };
  }

  const fuelCardName = extractStringValue(
    lead[zohoFuelCardNameField]
  ).trim();

  const fulfillmentType = extractStringValue(
    lead[zohoFulfillmentTypeField]
  ).trim();

  console.log(
    "VALIDATION RESULT: TOKEN IS ACTIVE"
  );

  console.log(
    "Fuel Card Name:",
    fuelCardName || "(empty)"
  );

  console.log(
    "Fulfillment Type:",
    fulfillmentType || "(empty)"
  );

  console.log(
    "================================================\n"
  );

  return {
    valid: true,
    crmToken,
    lead,
    fuelCardName,
    fulfillmentType,
  };
}

/* =========================================================
   STATIC ROUTES
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      publicPath,
      "index.html"
    )
  );
});

app.get("/verify", (req, res) => {
  res.sendFile(
    path.join(
      publicPath,
      "verify.html"
    )
  );
});

/*
 * Agreement step. Only reached by Cardless leads (Fulfillment_Type
 * gate — see /api/idv/success and /api/token/validate).
 */
app.get("/agreement", (req, res) => {
  res.sendFile(
    path.join(
      publicPath,
      "agreement.html"
    )
  );
});

/*
 * Zoho's "Redirect URL after submit" setting (on both Agreement
 * forms, in Zoho Forms builder) should point directly here now:
 *
 *   https://YOUR-DOMAIN/complete?token=${Plaid_Token}
 *
 * complete.html itself finalizes the CRM update (stage ->
 * Completed, token -> Used) when it sees a token in the URL, then
 * shows the completed state. No separate hand-off page needed.
 *
 * This route only exists so that if the Zoho form's redirect
 * setting still points at the old /agreement-complete URL, it
 * keeps working — it just forwards straight to /complete with
 * the same query string.
 */
app.get("/agreement-complete", (req, res) => {
  const queryString =
    new URLSearchParams(
      req.query
    ).toString();

  res.redirect(
    302,
    queryString
      ? `/complete?${queryString}`
      : "/complete"
  );
});

app.get("/complete", (req, res) => {
  res.sendFile(
    path.join(
      publicPath,
      "complete.html"
    )
  );
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    success: true,

    message:
      "Server is running",

    plaid_env: plaidEnv,

    zoho_connected: Boolean(
      zohoClientId &&
        zohoClientSecret &&
        zohoRefreshToken
    ),

    zoho_forms_configured:
      Boolean(
        zohoFormUrl &&
          zohoFormVeonUrl &&
          zohoAgreementFormUrl &&
          zohoAgreementFormVeonUrl
      ),

    timestamp:
      new Date().toISOString(),
  });
});

/* =========================================================
   VALIDATE TOKEN AND SELECT ZOHO FORM
========================================================= */

app.post(
  "/api/token/validate",
  async (req, res) => {
    try {
      console.log(
        "\n========== TOKEN VALIDATE REQUEST =========="
      );

      console.log(
        "Timestamp:",
        new Date().toISOString()
      );

      const { token, context } = req.body;

      if (
        !token ||
        String(token).trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          valid: false,
          message:
            "token is required",
        });
      }

      const requestContext = String(
        context || "form"
      )
        .trim()
        .toLowerCase();

      console.log(
        "Request context:",
        requestContext
      );

      const validation =
        await validateLeadToken(
          token
        );

      if (!validation.valid) {
        return res
          .status(
            validation.statusCode ||
              403
          )
          .json({
            success: false,
            valid: false,
            message:
              validation.message,
          });
      }

      const {
        lead,
        fuelCardName,
        fulfillmentType,
      } = validation;

      const currentPlaidStage =
        String(
          lead[
            zohoPlaidStageField
          ] || ""
        ).trim();

      let effectivePlaidStage =
        currentPlaidStage ||
        PLAID_STAGE_ZOHO_FORM;

      let normalizedStage =
        normalizePlaidStage(
          effectivePlaidStage
        );

      const normalizedZohoFormStage =
        normalizePlaidStage(
          PLAID_STAGE_ZOHO_FORM
        );

      const normalizedVerificationStage =
        normalizePlaidStage(
          PLAID_STAGE_VERIFICATION
        );

      const normalizedAgreementStage =
        normalizePlaidStage(
          PLAID_STAGE_AGREEMENT
        );

      let stageWasAdvanced = false;

      /*
       * Zoho Form endi o'zining "Redirect URL"
       * sozlamasi orqali foydalanuvchini
       * to'g'ridan-to'g'ri /verify sahifasiga
       * olib boradi (bizning JS orqali emas).
       * Shu sabab, agar /verify sahifasi token'ni
       * tekshirsa va CRM'da bosqich hali "Zoho form"
       * bo'lib qolgan bo'lsa — demak foydalanuvchi
       * hozirgina formani to'ldirib shu yerga
       * kelgan. Bosqichni SHU SO'ROV ICHIDA
       * "Plaid verification"ga o'zgartiramiz va
       * yangilangan qiymatni darhol javobda
       * qaytaramiz — bu alohida yozish/o'qish
       * so'rovlari orasidagi kechikish (Zoho COQL
       * eventual consistency) muammosini butunlay
       * bartaraf etadi.
       */
      if (
        requestContext === "verify" &&
        normalizedStage ===
          normalizedZohoFormStage
      ) {
        console.log(
          "Verify page detected stage still on Zoho form — advancing to Plaid verification now."
        );

        await updateLeadFields(
          lead.id,
          {
            [zohoPlaidStageField]:
              PLAID_STAGE_VERIFICATION,
          }
        );

        effectivePlaidStage =
          PLAID_STAGE_VERIFICATION;

        normalizedStage =
          normalizedVerificationStage;

        stageWasAdvanced = true;
      }

      /*
       * Same eventual-consistency safety net as the "verify"
       * block above, applied to the Agreement page.
       * /api/idv/success already decides the correct next
       * stage right after Plaid's onSuccess fires (Agreement
       * for Cardless, Completed for everyone else), but if the
       * Agreement page's own validate call lands before that
       * write is visible in COQL, this catches it.
       *
       * IMPORTANT: Agreement is gated by Fulfillment_Type, NOT
       * Fuel_Card_Name. If a Physical lead somehow lands on
       * /agreement (stale link, bookmark, etc.), we do NOT show
       * them an Agreement form — we finish the job here exactly
       * like /api/idv/success would, so they end up at /complete.
       */
      if (
        requestContext === "agreement" &&
        normalizedStage ===
          normalizedVerificationStage
      ) {
        const isCardlessLead =
          isCardlessFulfillmentType(
            fulfillmentType
          );

        if (isCardlessLead) {
          console.log(
            "Agreement page detected stage still on Plaid verification — advancing to Agreement now."
          );

          await updateLeadFields(
            lead.id,
            {
              [zohoPlaidStageField]:
                PLAID_STAGE_AGREEMENT,
            }
          );

          effectivePlaidStage =
            PLAID_STAGE_AGREEMENT;

          normalizedStage =
            normalizedAgreementStage;
        } else {
          console.log(
            "Physical lead reached the Agreement page — Agreement does not apply. Finalizing completion instead."
          );

          await updateLeadFields(
            lead.id,
            {
              [zohoPlaidStageField]:
                PLAID_STAGE_COMPLETED,

              [zohoTokenStatusField]:
                TOKEN_STATUS_USED,

              [zohoTokenUsedField]:
                formatZohoDateTime(),
            }
          );

          effectivePlaidStage =
            PLAID_STAGE_COMPLETED;

          normalizedStage =
            normalizePlaidStage(
              PLAID_STAGE_COMPLETED
            );
        }

        stageWasAdvanced = true;
      }

      let selectedForm = null;

      /*
       * Faqat Zoho Form bosqichida
       * Fuel_Card_Name bo‘yicha form tanlanadi:
       * - "Veon" contain bo‘lsa ZOHO_FORM_VEON_URL
       * - aks holda ZOHO_FORM_URL
       */
      if (
        normalizedStage ===
        normalizedZohoFormStage
      ) {
        selectedForm =
          getFormConfigForFuelCardName(
            fuelCardName
          );

        console.log(
          "Fuel Card Name:",
          fuelCardName || "(empty)"
        );

        console.log(
          "Selected Form Type:",
          selectedForm.formType
        );
      }

      /*
       * This stage is only ever reached by Cardless leads (see
       * the Fulfillment_Type gate above / in /api/idv/success).
       * The form VARIANT shown here still follows Fuel_Card_Name,
       * same isVeon pattern as the Application form.
       */
      let selectedAgreementForm = null;

      if (
        normalizedStage ===
        normalizedAgreementStage
      ) {
        selectedAgreementForm =
          getAgreementFormConfigForFuelCardName(
            fuelCardName
          );

        console.log(
          "Fuel Card Name:",
          fuelCardName || "(empty)"
        );

        console.log(
          "Selected Agreement Form Type:",
          selectedAgreementForm.formType
        );
      }

      /*
       * Plaid Stage bo‘sh bo‘lsa
       * birinchi bosqichga o‘rnatamiz.
       * (Agar yuqorida allaqachon
       * boshqa bosqichga o'tkazilgan
       * bo'lsa, bu yerga kirmaymiz.)
       */
      if (
        !currentPlaidStage &&
        !stageWasAdvanced
      ) {
        console.log(
          "First opening detected"
        );

        console.log(
          "Setting Plaid Stage:",
          PLAID_STAGE_ZOHO_FORM
        );

        await updateLeadFieldsBestEffort(
          lead.id,
          {
            [zohoPlaidStageField]:
              PLAID_STAGE_ZOHO_FORM,
          },
          "Set stage to Zoho form"
        );
      } else if (!stageWasAdvanced) {
        console.log(
          "Plaid Stage already exists:",
          currentPlaidStage
        );
      }

      console.log(
        "============================================\n"
      );

      return res.json({
        success: true,
        valid: true,

        message:
          "Verification token is valid",

        stage:
          effectivePlaidStage,

        fuel_card_name:
          fuelCardName,

        form_type:
          selectedForm?.formType ||
          null,

        form_url:
          selectedForm?.formUrl ||
          null,

        agreement_form_type:
          selectedAgreementForm?.formType ||
          null,

        agreement_form_url:
          selectedAgreementForm?.formUrl ||
          null,

        /*
         * NEW: lets index.html / verify.html render the correct
         * 3-step (Physical) or 4-step (Cardless) progress nav
         * without needing their own copy of this business rule.
         * agreement.html doesn't need this — it's only ever
         * reached by Cardless leads in the first place.
         */
        is_cardless:
          isCardlessFulfillmentType(
            fulfillmentType
          ),
      });
    } catch (error) {
      console.error(
        "\n========== TOKEN VALIDATION ERROR =========="
      );

      console.error(
        "Message:",
        error.message
      );

      console.error(
        "HTTP Status:",
        error.response?.status
      );

      console.error(
        "External response:",
        error.response?.data
      );

      console.error(
        "============================================\n"
      );

      return res
        .status(500)
        .json({
          success: false,
          valid: false,

          message:
            "Could not validate verification token",
        });
    }
  }
);

/* =========================================================
   SET PLAID VERIFICATION STAGE
   (Endi standart oqimda ishlatilmaydi — Zoho o'z
   "Redirect URL"i orqali to'g'ridan-to'g'ri /verify'ga
   o'tkazadi, va /api/token/validate shu yerda bosqichni
   o'zi ilgari suradi. Bu endpoint qo'lda/zaxira sifatida
   qoldirilgan.)
========================================================= */

app.post(
  "/api/stage/verification",
  async (req, res) => {
    try {
      console.log(
        "\n========== SET VERIFICATION STAGE =========="
      );

      console.log(
        "Timestamp:",
        new Date().toISOString()
      );

      const { token } = req.body;

      if (
        !token ||
        String(token).trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "token is required",
        });
      }

      const validation =
        await validateLeadToken(
          token
        );

      if (!validation.valid) {
        return res
          .status(
            validation.statusCode ||
              403
          )
          .json({
            success: false,
            message:
              validation.message,
          });
      }

      await updateLeadFields(
        validation.lead.id,
        {
          [zohoPlaidStageField]:
            PLAID_STAGE_VERIFICATION,
        }
      );

      console.log(
        "Lead ID:",
        validation.lead.id
      );

      console.log(
        "Plaid Stage changed to:",
        PLAID_STAGE_VERIFICATION
      );

      console.log(
        "============================================\n"
      );

      return res.json({
        success: true,

        message:
          "Plaid verification stage set",

        stage:
          PLAID_STAGE_VERIFICATION,
      });
    } catch (error) {
      console.error(
        "\n========== SET VERIFICATION STAGE ERROR =========="
      );

      console.error(
        "Message:",
        error.message
      );

      console.error(
        "HTTP Status:",
        error.response?.status
      );

      console.error(
        "Response:",
        error.response?.data
      );

      console.error(
        "==================================================\n"
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Could not prepare identity verification",
        });
    }
  }
);

/* =========================================================
   CREATE PLAID LINK TOKEN
========================================================= */

app.post(
  "/api/idv/create_link_token",
  async (req, res) => {
    try {
      console.log(
        "\n========== CREATE LINK TOKEN REQUEST =========="
      );

      console.log(
        "Timestamp:",
        new Date().toISOString()
      );

      const { token } = req.body;

      if (
        !token ||
        String(token).trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message: "token is required",
        });
      }

      console.log(
        "Received token:",
        maskToken(token)
      );

      const validation =
        await validateLeadToken(token);

      if (!validation.valid) {
        console.log(
          "Token validation failed:",
          validation.message
        );

        return res
          .status(
            validation.statusCode || 403
          )
          .json({
            success: false,
            message: validation.message,
          });
      }

      /*
       * validateLeadToken() quyidagilarni qaytaradi:
       * {
       *   valid: true,
       *   crmToken,
       *   lead,
       *   fuelCardName
       * }
       */
      const {
        lead,
        crmToken,
      } = validation;

      /*
       * MUHIM:
       * Plaid client_user_id sifatida Lead ID emas,
       * CRM'dagi Plaid_Token yuboriladi.
       */
      const plaidClientUserId =
        String(
          crmToken ||
          lead[zohoPlaidTokenField] ||
          token
        ).trim();

      if (!plaidClientUserId) {
        return res.status(400).json({
          success: false,
          message:
            "Plaid token is missing on the Lead",
        });
      }

      /*
       * Xavfsizlik uchun request token va CRM token
       * bir xil ekanini tekshiramiz.
       */
      if (
        normalizeText(
          plaidClientUserId
        ) !==
        normalizeText(token)
      ) {
        console.error(
          "Request token and CRM token do not match"
        );

        return res.status(403).json({
          success: false,
          message:
            "Verification token does not match the CRM Lead",
        });
      }

      console.log(
        "Creating Plaid Link Token"
      );

      console.log(
        "Lead ID:",
        lead.id
      );

      console.log(
        "Plaid client_user_id token:",
        maskToken(
          plaidClientUserId
        )
      );

      const plaidResponse =
        await plaidClient.linkTokenCreate({
          user: {
            client_user_id:
              plaidClientUserId,
          },

          client_name:
            "United Transports",

          products: [
            "identity_verification",
          ],

          identity_verification: {
            template_id:
              plaidTemplateId,
          },

          country_codes: ["US"],

          language: "en",
        });

      await updateLeadFieldsBestEffort(
        lead.id,
        {
          [zohoPlaidStageField]:
            PLAID_STAGE_VERIFICATION,
        },
        "Set stage after Plaid Link Token creation"
      );

      console.log(
        "Plaid Link Token created successfully"
      );

      console.log(
        "Lead ID:",
        lead.id
      );

      console.log(
        "Plaid request ID:",
        plaidResponse.data.request_id
      );

      console.log(
        "================================================\n"
      );

      return res.json({
        success: true,

        link_token:
          plaidResponse.data.link_token,

        request_id:
          plaidResponse.data.request_id,
      });
    } catch (error) {
      console.error(
        "\n========== CREATE LINK TOKEN ERROR =========="
      );

      console.error(
        "Timestamp:",
        new Date().toISOString()
      );

      console.error(
        "Message:",
        error.message
      );

      console.error(
        "HTTP Status:",
        error.response?.status
      );

      console.error(
        "External response:",
        error.response?.data
      );

      console.error(
        "=============================================\n"
      );

      return res.status(500).json({
        success: false,

        message:
          "Failed to validate token or create Plaid link token",

        error:
          process.env.NODE_ENV ===
          "development"
            ? error.response?.data ||
              error.message
            : undefined,
      });
    }
  }
);

/* =========================================================
   PLAID VERIFICATION SUCCEEDED
   (This is what verify.html's onSuccess calls now.)

   Agreement is a CARDLESS-ONLY step (gated by Fulfillment_Type,
   NOT Fuel_Card_Name):
     - Cardless leads -> advance to "Agreement" stage, do NOT
                         mark the token Used yet. Completion
                         happens once the Agreement form is
                         actually submitted (/api/idv/complete).
     - Physical leads -> finalize immediately: stage ->
                         "Completed", token -> "Used". Same
                         behavior as before Agreement existed.

   Fuel_Card_Name / isVeon plays no part in this decision — it
   only picks which form VARIANT (Veon vs default) is shown for
   the Application form, and later for the Agreement form on
   the /agreement page itself, once we already know Agreement
   applies.

   The response tells the client which route to go to next
   (next_route: "/agreement" or "/complete") so verify.html
   doesn't need its own copy of this business rule.
========================================================= */

app.post(
  "/api/idv/success",
  async (req, res) => {
    try {
      console.log(
        "\n========== IDV SUCCESS =========="
      );

      console.log(
        "Timestamp:",
        new Date().toISOString()
      );

      const { token } = req.body;

      if (
        !token ||
        String(token).trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "token is required",
        });
      }

      console.log(
        "Received token:",
        maskToken(token)
      );

      const validation =
        await validateLeadToken(
          token
        );

      if (!validation.valid) {
        return res
          .status(
            validation.statusCode ||
              403
          )
          .json({
            success: false,
            message:
              validation.message,
          });
      }

      const {
        lead,
        fuelCardName,
        fulfillmentType,
      } = validation;

      const isCardless =
        isCardlessFulfillmentType(
          fulfillmentType
        );

      console.log(
        "Lead ID:",
        lead.id
      );

      console.log(
        "Fulfillment Type:",
        fulfillmentType || "(empty)"
      );

      console.log(
        "Is Cardless:",
        isCardless
      );

      console.log(
        "Fuel Card Name:",
        fuelCardName || "(empty)"
      );

      if (isCardless) {
        console.log(
          "Plaid Stage:",
          PLAID_STAGE_AGREEMENT
        );

        await updateLeadFields(
          lead.id,
          {
            [zohoPlaidStageField]:
              PLAID_STAGE_AGREEMENT,
          }
        );

        console.log(
          "Lead advanced to Agreement stage"
        );

        console.log(
          "==================================\n"
        );

        return res.json({
          success: true,

          message:
            "Advanced to Agreement stage",

          stage:
            PLAID_STAGE_AGREEMENT,

          next_route: "/agreement",
        });
      }

      /*
       * Physical: no Agreement step. Finalize completion right
       * away, exactly like /api/idv/complete used to do
       * directly from verify.html before Agreement existed.
       */
      const usedTime =
        formatZohoDateTime();

      console.log(
        "Plaid Stage:",
        PLAID_STAGE_COMPLETED
      );

      console.log(
        "Token Status:",
        TOKEN_STATUS_USED
      );

      await updateLeadFields(
        lead.id,
        {
          [zohoPlaidStageField]:
            PLAID_STAGE_COMPLETED,

          [zohoTokenStatusField]:
            TOKEN_STATUS_USED,

          [zohoTokenUsedField]:
            usedTime,
        }
      );

      console.log(
        "Lead marked Completed successfully (no Agreement step for this Fulfillment Type)"
      );

      console.log(
        "==================================\n"
      );

      return res.json({
        success: true,

        message:
          "Plaid verification completed",

        stage:
          PLAID_STAGE_COMPLETED,

        next_route: "/complete",
      });
    } catch (error) {
      console.error(
        "\n========== IDV SUCCESS ERROR =========="
      );

      console.error(
        "Timestamp:",
        new Date().toISOString()
      );

      console.error(
        "Message:",
        error.message
      );

      console.error(
        "Response:",
        error.response?.data
      );

      console.error(
        "========================================\n"
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Failed to process Plaid verification success",
        });
    }
  }
);

/* =========================================================
   COMPLETE VERIFICATION
   (Called by complete.html itself, when it loads with a token
   in the URL — meaning the Agreement form was just submitted
   and Zoho redirected here. Marks the Lead Completed and the
   token Used. Not called at all for Physical leads, whose
   completion already happened in /api/idv/success.)
========================================================= */

app.post(
  "/api/idv/complete",
  async (req, res) => {
    try {
      console.log(
        "\n========== IDV COMPLETE REQUEST =========="
      );

      console.log(
        "Timestamp:",
        new Date().toISOString()
      );

      const { token } = req.body;

      if (
        !token ||
        String(token).trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "token is required",
        });
      }

      console.log(
        "Received token:",
        maskToken(token)
      );

      const validation =
        await validateLeadToken(
          token
        );

      if (!validation.valid) {
        return res
          .status(
            validation.statusCode ||
              403
          )
          .json({
            success: false,
            message:
              validation.message,
          });
      }

      const { lead } = validation;

      const usedTime =
        formatZohoDateTime();

      console.log(
        "Updating completed status"
      );

      console.log(
        "Lead ID:",
        lead.id
      );

      console.log(
        "Plaid Stage:",
        PLAID_STAGE_COMPLETED
      );

      console.log(
        "Token Status:",
        TOKEN_STATUS_USED
      );

      console.log(
        "Used Time:",
        usedTime
      );

      await updateLeadFields(
        lead.id,
        {
          [zohoPlaidStageField]:
            PLAID_STAGE_COMPLETED,

          [zohoTokenStatusField]:
            TOKEN_STATUS_USED,

          [zohoTokenUsedField]:
            usedTime,
        }
      );

      console.log(
        "Lead marked Completed successfully"
      );

      console.log(
        "==========================================\n"
      );

      return res.json({
        success: true,

        message:
          "Plaid verification completed",

        stage:
          PLAID_STAGE_COMPLETED,

        token_status:
          TOKEN_STATUS_USED,
      });
    } catch (error) {
      console.error(
        "\n========== IDV COMPLETE ERROR =========="
      );

      console.error(
        "Timestamp:",
        new Date().toISOString()
      );

      console.error(
        "Message:",
        error.message
      );

      console.error(
        "Response:",
        error.response?.data
      );

      console.error(
        "========================================\n"
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Failed to update Plaid completion status",
        });
    }
  }
);

/* =========================================================
   GET PLAID IDENTITY VERIFICATION RESULT
========================================================= */

app.post(
  "/api/idv/get",
  async (req, res) => {
    try {
      const {
        identity_verification_id,
      } = req.body;

      if (
        !identity_verification_id ||
        String(
          identity_verification_id
        ).trim() === ""
      ) {
        return res.status(400).json({
          success: false,

          message:
            "identity_verification_id is required",
        });
      }

      console.log(
        "\n========== IDV GET REQUEST =========="
      );

      console.log(
        "Identity Verification ID:",
        identity_verification_id
      );

      const response =
        await plaidClient
          .identityVerificationGet({
            identity_verification_id:
              String(
                identity_verification_id
              ).trim(),
          });

      console.log(
        "Plaid IDV Status:",
        response.data?.status
      );

      console.log(
        "=====================================\n"
      );

      return res.json({
        success: true,
        data: response.data,
      });
    } catch (error) {
      console.error(
        "\n========== IDV GET ERROR =========="
      );

      console.error(
        "Message:",
        error.message
      );

      console.error(
        "HTTP Status:",
        error.response?.status
      );

      console.error(
        "Plaid response:",
        error.response?.data
      );

      console.error(
        "===================================\n"
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Failed to get identity verification",

          error:
            process.env.NODE_ENV ===
            "development"
              ? error.response?.data ||
                error.message
              : undefined,
        });
    }
  }
);

/* =========================================================
   404 HANDLER
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "Unhandled server error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Internal server error",
    });
  }
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, () => {
  console.log(
    `Server running: http://localhost:${PORT}`
  );
});