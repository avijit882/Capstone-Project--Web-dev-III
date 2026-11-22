# Assignment Requirement Traceability

This matrix maps the supplied Backend Development Capstone Project Assignment to the CampusCart source and the verification still expected before submission.

| Assignment requirement | CampusCart implementation | Evidence / verification |
|---|---|---|
| Node.js and Express REST backend | `src/server.js`, `src/app.js` | Start the server and call `/health` |
| MVC or explained layered architecture | `src/routes/`, `src/controllers/`, `src/middleware/`, `src/services.js`, `src/models/` | Trace a request from route through model and response |
| MongoDB and Mongoose | `src/config/db.js`, `src/models/index.js` | Connect a replica set and inspect collections |
| CRUD for major entities | Category and product route/controller/service groups | Exercise create, read, update and deactivate endpoints |
| HTTP methods, JSON responses and status codes | `src/routes/`, `src/controllers/`, `src/utils.js` | Postman positive and negative tests |
| Centralized error handling and middleware | `src/middleware/`, `src/utils.js`, `src/app.js` | Missing token, invalid ID, invalid body and unknown route |
| bcrypt password hashing | `User.hashPassword`, `auth.register`, `auth.login` | Register and inspect stored password hash; verify login |
| JWT access and refresh token handling | `src/utils.js`, `auth.rotate`, `auth.logout`, `User.sessionVersion` | Login, rotation, logout, token-family replay revocation and seller-suspension invalidation |
| Protected routes and RBAC | `src/middleware/auth.js` and feature routes | Cross-role and resource ownership tests |
| dotenv and environment configuration | `src/config/env.js`, `.env.example` | Start with a local `.env`; never commit it |
| At least two meaningful aggregations | `reports.sales`, `reports.best`, `reports.inventory` in `src/services.js` | Run reports against seeded and known test data |
| At least two suitable indexes | `src/models/index.js` | Inspect indexes with MongoDB `getIndexes()` |
| Meaningful EventEmitter event | `src/realtime.js`, `events` in services | Trigger order and low-stock events |
| Socket.IO real-time feature | `src/realtime.js` | Authenticated and unauthenticated socket tests |
| Postman API collection | `postman/` | Import collection/environment and execute requests |
| Success, validation, unauthorized and business-rule tests | `tests/campuscart.test.js` | Execute `npm test` against a replica-set test database |
| Sample data / seed script | `scripts/seed.js` | Run `npm run seed` on a local database |
| README, database/API documentation, report | `README.md`, `docs/` | Review all documentation and fill student/faculty fields |
| Demonstration and viva | `docs/DEMO_SCRIPT.md`, `docs/VIVA_PREPARATION.md` | Perform a live demonstration and explain individual contribution |

## Evidence status at package preparation

Static JavaScript syntax checks and JSON/YAML parsing were performed in the authoring environment. Dependency installation and live MongoDB/API/Socket.IO tests were not executed there because the environment could not reach the npm registry and did not provide Docker or MongoDB. The integration tests are supplied but must be run on a machine with dependencies and a replica-set-capable MongoDB before describing the project as runtime-verified. See `PROJECT_STATUS.md` and `docs/TESTING.md`.
