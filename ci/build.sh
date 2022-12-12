#!/bin/sh
set -xe

#Login to registry
echo $GITHUB_PASSWORD | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin
#Build and push image
docker build -t ghcr.io/aura-nw/aura-indexer-crawl:migrate-artaverse.1 -f Dockerfile .
docker push ghcr.io/aura-nw/aura-indexer-crawl:migrate-artaverse.1