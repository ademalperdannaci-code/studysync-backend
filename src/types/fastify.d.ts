import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { userId: string; email: string; username: string };
    user: { userId: string; email: string; username: string };
  }
}