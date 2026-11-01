# An AppMaker application

This folder is the whole application: the AppMaker runtime (`server/` and `public/`), and the
project's forms, scripts, workflows, jobs, pictures and settings under `data/`.

## Run it

    npm ci --omit=dev
    npm start

`npm ci` installs the versions `package-lock.json` pins, the ones the application was built
with. A folder without that file takes `npm install --omit=dev` instead. Node 24 or later.

The app listens on port 3000 on every interface and answers at `/app`. `config.json` holds the
port (`port`), the address to listen on (`bindHost`), and the Node modules workflow expressions
may require (`serverRequireAllow`; server scripts reach no Node modules). `PORT` and
`GD_BIND_HOST` override the first two from the environment.

Set `GD_PUBLIC_ORIGIN` to the address users reach the app at (for example
`https://app.example.com`) so that the links in sign-up, invitation and password reset mails
point there.

## State

The database and everything the app writes while running live under `data_runtime/`, next to
`data/`. The folder is created on first start: the database is built from
`data/db/schema.json` and filled with its seed rows. Keep `data_runtime/` between restarts and
back it up; it is the app's data. `data/` is the application itself and changes only with a new
deployment.

## Notes

- This is app mode: the designer and its API are not part of the deployment. `/` opens the app.
- `data/project.json` carries the mail settings including the password, as the app needs them
  to send mail. Treat the folder accordingly.
- Server scripts run as the application: they can reach its database, its file store and
  outbound `fetch`, but no Node modules; `serverRequireAllow` lists the Node modules workflow
  expressions may `require`.
