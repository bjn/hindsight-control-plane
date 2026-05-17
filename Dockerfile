FROM node:22-alpine

RUN npm install -g @vectorize-io/hindsight-control-plane@0.6.2

ENV PORT=9999 \
    HOSTNAME=0.0.0.0 \
    HINDSIGHT_CP_DATAPLANE_API_URL=http://hindsight-memory:8888

EXPOSE 9999

CMD ["hindsight-control-plane", "--port", "9999", "--hostname", "0.0.0.0", "--api-url", "http://hindsight-memory:8888"]
