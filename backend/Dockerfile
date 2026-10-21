# Compilación
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -q -B dependency:go-offline
COPY src src
RUN ./mvnw -q -B package -DskipTests

# Ejecución (usuario sin privilegios)
FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 gameshare
WORKDIR /app
COPY --from=build /src/target/backend-*.jar app.jar
USER gameshare
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
