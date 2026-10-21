package dev.gameshare.backend.api;

import dev.gameshare.backend.session.AuthContext;
import dev.gameshare.backend.session.SessionService;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/** Inyecta un {@link AuthContext} a partir de "Authorization: Bearer &lt;token&gt;", o responde 401. */
@Component
public class AuthArgumentResolver implements HandlerMethodArgumentResolver {

    private final SessionService sessions;

    public AuthArgumentResolver(SessionService sessions) {
        this.sessions = sessions;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.getParameterType() == AuthContext.class;
    }

    @Override
    public AuthContext resolveArgument(MethodParameter parameter, ModelAndViewContainer mav,
                                       NativeWebRequest request, WebDataBinderFactory binderFactory) {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith("Bearer ")) {
            throw ApiException.unauthorized();
        }
        return sessions.authenticate(header.substring(7).trim());
    }
}
