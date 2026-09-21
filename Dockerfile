FROM docker.io/cloudflare/sandbox:0.12.9

COPY fixtures/sample-repo /opt/fixtures/order-service
RUN git -C /opt/fixtures/order-service init \
    && git -C /opt/fixtures/order-service config user.name "Peer Point Fixture" \
    && git -C /opt/fixtures/order-service config user.email "fixture@invalid.example" \
    && git -C /opt/fixtures/order-service add . \
    && git -C /opt/fixtures/order-service commit -m "Seed deterministic failing fixture"

EXPOSE 8080
