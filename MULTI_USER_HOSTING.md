# Multi-User Hosting

This app is designed to be safely hosted for multiple users. Each user configures their own credentials in the browser; the server does not store credentials or user data.

## Security model

- **Credentials are per-user** – Stored in the browser (localStorage), never sent to the server except as request headers for API calls. The server does not persist them.
- **Stateless server** – No user accounts or server-side sessions. All Confluence/Jira/AI/LaunchNotes credentials are provided by the client per request.

## Deployment recommendations

- **HTTPS** – Use HTTPS in production so credentials in request headers are encrypted in transit.
- **CORS** – Configure the server’s allowed origins for your frontend domain (e.g. via environment or server config) so only your app can call the API.
- **Environment** – Use a reverse proxy (e.g. nginx) or platform (e.g. Heroku, Railway) and set `PORT` if needed. No `.env` is required for multi-user use; credentials come from each user’s Settings in the app.

## Optional server `.env` fallback

For development or Electron, you can optionally set Confluence/Jira/AI/LaunchNotes variables in a `.env` file; the server uses these only when the client does not send the corresponding headers. For shared hosting, rely on per-user Settings in the app and do not put secrets in `.env`.
