# Use the official WAHA image as the base
FROM devlikeapro/waha:latest

# Set the environment variables specified in your docker-compose
ENV WAHA_SESSION=default
ENV WAHA_SESSION_AUTO_START=true
ENV WHATSAPP_DEFAULT_ENGINE=NOWEB

# Expose the internal port the app listens on 
# (Note: Port mapping happens at runtime, but this documents the port)
EXPOSE 3000