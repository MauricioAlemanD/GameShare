package dev.gameshare.backend.config;

import dev.gameshare.backend.signaling.SignalingHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    /** Tamaño máximo de un mensaje de texto (un SDP típico ocupa entre 3 y 10 KB). */
    public static final int MAX_TEXT_MESSAGE = 64 * 1024;

    private final SignalingHandler handler;
    private final GameShareProperties props;

    public WebSocketConfig(SignalingHandler handler, GameShareProperties props) {
        this.handler = handler;
        this.props = props;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws").setAllowedOrigins(props.allowedOrigins().toArray(String[]::new));
    }

    @Bean
    ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(MAX_TEXT_MESSAGE);
        container.setMaxBinaryMessageBufferSize(1024);
        // El cliente envía un ping cada ~20 s; sin actividad durante 60 s se cierra la conexión.
        container.setMaxSessionIdleTimeout(60_000L);
        return container;
    }
}
