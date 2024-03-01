const DEFAULT_SECRET_TOKEN = "default_secret_token";
require('dotenv').config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const { auth } = require("express-oauth2-jwt-bearer");
const authConfig = require("./src/auth_config.json");
//const stripe = require('stripe')(process.env.STRIPE_KEY);
const stripe = require('stripe')(authConfig.stripeSecretkey);
const axios = require('axios');
const bodyParser = require('body-parser');
const { data } = require("autoprefixer");

const app = express();
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }));
const actoken = process.env.SECRET_TOKEN || DEFAULT_SECRET_TOKEN;
const port = process.env.PORT || 3002;

if (
  !authConfig.domain ||
  !authConfig.audience ||
  authConfig.audience === "YOUR_API_IDENTIFIER"
) {
  console.log(
    "Exiting: Please make sure that auth_config.json is in place and populated with valid domain and audience values"
  );

  process.exit();
}

app.use(morgan("dev"));
app.use(helmet());
//app.use(cors({ origin: appOrigin }));
app.use(cors({
  origin: 'https://darulkitab.in',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  headers: 'Content-Type, Authorization',
}));


// Enable CORS middleware for the entire application
//app.use(cors(corsOptions));



//===================== API Authorization to Search user data ==================
const checkJwt = auth({
  audience: authConfig.audience,
  issuerBaseURL: `https://${authConfig.domain}/`,
  algorithms: ["RS256"],
});

let stripeUser;
var userEmail;
var idemail;

// Middleware to log request data and set stripeUser
app.use(checkJwt, (req, res, next) => {
  try {

    // Extract user ID from JWT payload
    const payloadData = req.auth.payload.sub;
    stripeUser = payloadData;
    console.log('Stripe User ID: ' + stripeUser);

    // Getting email ID from axios http request from auth0 mgmt api
    let authorizeUser = {
      method: 'get',
      maxBodyLength: Infinity,
      url: 'https://dev-7r7jxjl0zftrqkq8.us.auth0.com/api/v2/users',
      //params: { q: `email: ${stripeUserEmail}`, search_engine: 'v3' },
      params: { q: `user_id: ${stripeUser}`, search_engine: 'v3' },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${actoken}`
      },
    };

    axios.request(authorizeUser)
      .then((response) => {
        const userData = response.data;
        idemail = userData[0].email;
        console.log(idemail + ' got email from app.use');
      })
      .catch((error) => {
        console.log(error);
      });


    // Continue processing the request
    next();
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/api/external", checkJwt, async (req, res) => {

  try {

    let authorizeUser = {
      method: 'get',
      maxBodyLength: Infinity,
      url: 'https://dev-7r7jxjl0zftrqkq8.us.auth0.com/api/v2/users',
      //params: { q: `email: ${stripeUserEmail}`, search_engine: 'v3' },
      params: { q: `user_id: ${stripeUser}`, search_engine: 'v3' },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${actoken}`
      },
    };

    axios.request(authorizeUser)
      .then((response) => {
        const userData = response.data;
        idemail = userData[0].email;
        console.log(idemail + ' got email');

        const email = idemail;

        // Check stripe payment status with email
        const getEmailCustomers = async (email) => {
          try {
            const customers = await stripe.customers.list({ email });
            const cus_id = customers.data.map((customer) => customer.id);
            console.log(cus_id);
            return customers.data.map((customer) => customer.id);
          } catch (err) {
            console.error(err);
            throw err;
          }
        };

        const getPaymentIntentsForCustomer = async (customerId) => {
          try {
            const paymentIntents = await stripe.paymentIntents.list({
              customer: customerId,
            });
            console.log(paymentIntents.data);
            return paymentIntents.data;
          } catch (err) {
            console.error(err);
            throw err;
          }
        };

        const checkPaymentStatus = (paymentIntent) => {
          const status = paymentIntent.status;
          const succeeded = 'succeeded';

          if (status === succeeded) {
            console.log('The customer has paid!');
            return true;
          } else {
            console.log('The customer has not paid yet.');
            return false;
          }
        };

        getEmailCustomers(email)
          .then(async (customerIds) => {
            let anyCustomerPaid = false;

            if (customerIds.length > 0) {
              console.log('Total Customers : ' + customerIds.length);

              for (const customerId of customerIds) {
                const paymentIntents = await getPaymentIntentsForCustomer(customerId);

                console.log(`Number of Payment Intents for Customer ${customerId}: ${paymentIntents.length}`);

                // if (paymentIntents.length > 0) {
                //   const paymentStatusFinal = checkPaymentStatus(paymentIntents[0]);

                //   if (paymentStatusFinal) {
                //     anyCustomerPaid = true;
                //     break; // Exit the loop as we found a successful payment
                //   }
                // } else {
                //   console.log(`No payment intents found for customer ${customerId}`);
                // }

                for (let i = 0; i < paymentIntents.length; i++) {
                  const paymentStatusFinal = checkPaymentStatus(paymentIntents[i]);
                
                  if (paymentStatusFinal) {
                    anyCustomerPaid = true;
                    break; // Exit the loop as we found a successful payment
                  }
                }
                
                if (paymentIntents.length === 0) {
                  console.log(`No payment intents found for customer ${customerId}`);
                }
                
              }

              if (anyCustomerPaid) {
                res.send({
                  msg: "Your access token was successfully validated!",
                  hasActiveSubscription: true
                });
              } else {
                res.send({ hasActiveSubscription: false });
              }
            } else {
              console.log("No Customers yet");
              res.json({ hasActiveSubscription: false });
            }
          })
          .catch((error) => {
            console.error(error);
            res.status(500).json({ success: false, error: "Internal Server Error" });
          });

      })
      .catch((error) => {
        console.log(error);
      });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }

});

app.listen(port, () => console.log(`API Server listening on port ${port}`));
