import { HydrateClient } from "~/trpc/server";

function HomePage() {
  return (
    <HydrateClient>
      <main className="container h-screen py-16">
        <h1>Hello World</h1>
      </main>
    </HydrateClient>
  );
}

export default HomePage;
