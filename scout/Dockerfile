# Plow x OpenClaw base image, pinned by tag AND digest. The tag is one immutable
# release per commit of plow-pbc/plow-openclaw-agent; the digest guards the tag.
# Bump both together. Resolve a new base with:
#   docker buildx imagetools inspect \
#     public.ecr.aws/e1h7x4a2/plow-cloud-agents:base-<commit-sha>
FROM public.ecr.aws/e1h7x4a2/plow-cloud-agents:base-771198a9609dcef54d44843e7da5329c17fa51b4@sha256:f1e7c421b97a80f1bd17015f96daceb965f350a241f7edc7e4d856a0e3a6f8f5

# Links the GHCR package page to the repo (README, contributors).
LABEL org.opencontainers.image.source="https://github.com/sneldao/snapflip"

# Agent Index identity. At boot the image registers/claims this listing and
# reports token usage every 5 minutes. A cloud install has no compose file, so
# the id can only come from here — without it nothing is reported.
ENV AGENT_ID=snapflip-scout
ENV AGENT_NAME="Scout"
ENV AGENT_BLURB="SnapFlip's collector desk. Text it the game you lost as a kid — it prices the buy-back off real collector data, watches until one appears, and arms a standing order that bids while it's still on the rack."

# New groups ask the owner for a trust level instead of silently gaining the
# owner's full tools (Mac, mail, files). Plow default is `ask`; keep it.
# ENV PLOW_THREAD_TRUST=ask

COPY prompt/AGENTS.md /opt/plow/prompt/AGENTS.md
COPY skills/ /opt/plow/skills/
