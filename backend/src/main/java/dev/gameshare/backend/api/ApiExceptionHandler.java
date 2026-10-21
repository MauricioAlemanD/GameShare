package dev.gameshare.backend.api;

import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Todas las respuestas de error tienen el formato {"error": CODIGO, "message": texto legible}. */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    public record ErrorBody(String error, String message) {
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ErrorBody> api(ApiException e) {
        return ResponseEntity.status(e.status()).body(new ErrorBody(e.code(), e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ErrorBody> validation(MethodArgumentNotValidException e) {
        Map<String, String> fields = e.getBindingResult().getFieldErrors().stream()
                .collect(Collectors.toMap(f -> f.getField(), f -> String.valueOf(f.getDefaultMessage()), (a, b) -> a));
        String msg = fields.entrySet().stream().map(x -> x.getKey() + ": " + x.getValue())
                .collect(Collectors.joining("; "));
        return ResponseEntity.badRequest().body(new ErrorBody("VALIDATION_ERROR", msg));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ErrorBody> unreadable(HttpMessageNotReadableException e) {
        return ResponseEntity.badRequest().body(new ErrorBody("MALFORMED_REQUEST", "El cuerpo de la petición no es JSON válido."));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ErrorBody> mediaType(HttpMediaTypeNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(new ErrorBody("UNSUPPORTED_MEDIA_TYPE", "Usa Content-Type: application/json."));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ErrorBody> method(HttpRequestMethodNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .body(new ErrorBody("METHOD_NOT_ALLOWED", "Método no permitido."));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ErrorBody> notFound(NoResourceFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ErrorBody("NOT_FOUND", "Recurso no encontrado."));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorBody> unexpected(Exception e) {
        log.error("Error inesperado", e);
        return ResponseEntity.internalServerError().body(new ErrorBody("INTERNAL_ERROR", "Error interno del servidor."));
    }
}
