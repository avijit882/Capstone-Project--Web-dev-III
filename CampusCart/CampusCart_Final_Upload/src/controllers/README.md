# Controller layer

Controllers translate HTTP requests into service calls and format HTTP responses. Business rules remain in `src/services.js`; Mongoose persistence remains in `src/models/index.js`. Route files apply authentication, authorization and route-parameter validation before controllers run.
