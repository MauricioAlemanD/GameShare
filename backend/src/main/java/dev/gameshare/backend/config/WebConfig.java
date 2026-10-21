package dev.gameshare.backend.config;

import dev.gameshare.backend.api.AuthArgumentResolver;
import java.util.List;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final GameShareProperties props;
    private final AuthArgumentResolver authArgumentResolver;

    public WebConfig(GameShareProperties props, AuthArgumentResolver authArgumentResolver) {
        this.props = props;
        this.authArgumentResolver = authArgumentResolver;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // Autenticación por token Bearer: no se usan cookies, así que no se permiten credenciales CORS.
        registry.addMapping("/api/**")
                .allowedOrigins(props.allowedOrigins().toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "DELETE")
                .allowedHeaders("Authorization", "Content-Type")
                .allowCredentials(false)
                .maxAge(600);
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(authArgumentResolver);
    }
}
