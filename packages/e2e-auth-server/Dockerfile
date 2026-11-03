FROM node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39
WORKDIR /usr/src/app

RUN corepack enable

COPY package* pnpm* .pnpmfile.cjs ./
COPY ./packages/e2e-auth-server/package.json ./packages/e2e-auth-server/

WORKDIR /usr/src/app/packages/e2e-auth-server
RUN pnpm install --frozen-lockfile

COPY ./packages/e2e-auth-server ./

EXPOSE 2286
CMD ["pnpm", "run", "start"]
