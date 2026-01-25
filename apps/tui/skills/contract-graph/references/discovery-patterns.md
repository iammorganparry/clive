# Discovery Patterns Reference

This document provides patterns for discovering contracts in different frameworks and technologies.

**This skill is technology-agnostic.** It supports discovery across multiple programming languages and frameworks.

## Supported Languages Overview

| Language | HTTP Frameworks | Database | Events |
|----------|----------------|----------|--------|
| **TypeScript/JavaScript** | Express, Fastify, Hono, Next.js, tRPC, NestJS | Drizzle, Prisma, TypeORM | Custom, Kafka, Redis, Inngest |
| **Python** | Flask, FastAPI, Django, Starlette | SQLAlchemy, Django ORM, Tortoise | Celery, RabbitMQ, Kafka |
| **Go** | Gin, Echo, Chi, Fiber, net/http | GORM, sqlx, database/sql, Ent | NATS, Kafka, Redis |
| **Rust** | Actix-web, Axum, Rocket, Warp | Diesel, SQLx, SeaORM | Tokio channels, Kafka, NATS |
| **Java** | Spring Boot, Quarkus, Micronaut | JPA/Hibernate, JDBC, jOOQ | Spring Events, Kafka, RabbitMQ |
| **Ruby** | Rails, Sinatra, Hanami | ActiveRecord, Sequel | Sidekiq, Kafka, RabbitMQ |
| **C#** | ASP.NET Core, Minimal APIs | Entity Framework, Dapper | MassTransit, Azure Service Bus |
| **PHP** | Laravel, Symfony | Eloquent, Doctrine | Laravel Queue, RabbitMQ |

---

## Universal Discovery Patterns

These patterns work across **all** languages:

### Universal HTTP Method Detection
```bash
# Finds HTTP methods mentioned in any language
grep -rni "GET\|POST\|PUT\|PATCH\|DELETE" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" --include="*.rb" --include="*.ts" --include="*.js" --include="*.cs"
```

### Universal SQL Detection
```bash
# SQL keywords work in ANY language
grep -rni "SELECT\s\|INSERT\s\|UPDATE\s\|DELETE\s\|CREATE TABLE"
```

### Universal Event Keywords
```bash
# Event patterns across languages
grep -rni "publish\|subscribe\|emit\|dispatch\|consume\|producer\|consumer"
```

### Universal External URL Detection
```bash
# HTTP URLs in any language
grep -rn "https://\|http://"
```

---

# TypeScript/JavaScript Patterns

## API Endpoints

### Express.js

```typescript
// Route handlers
app.get('/api/users', handler)
app.post('/api/users', handler)
app.put('/api/users/:id', handler)
app.patch('/api/users/:id', handler)
app.delete('/api/users/:id', handler)

// Router patterns
const router = express.Router()
router.get('/', handler)
router.post('/', handler)

// Middleware with paths
app.use('/api', apiRouter)
```

**Search patterns:**
```bash
grep -rn "app\.\(get\|post\|put\|patch\|delete\)\s*(" --include="*.ts" --include="*.js"
grep -rn "router\.\(get\|post\|put\|patch\|delete\)\s*(" --include="*.ts" --include="*.js"
grep -rn "Router()" --include="*.ts" --include="*.js"
```

### Fastify

```typescript
// Route handlers
fastify.get('/api/users', handler)
fastify.post('/api/users', handler)

// Route options
fastify.route({
  method: 'GET',
  url: '/api/users',
  handler: handler
})

// Plugins
fastify.register(routes, { prefix: '/api' })
```

**Search patterns:**
```bash
grep -rn "fastify\.\(get\|post\|put\|patch\|delete\)\s*(" --include="*.ts"
grep -rn "\.route\s*({" --include="*.ts"
```

### tRPC

```typescript
// Router definition
export const appRouter = router({
  user: userRouter,
  order: orderRouter,
})

// Query procedures
publicProcedure
  .input(z.object({ id: z.string() }))
  .query(({ input }) => {
    return getUser(input.id)
  })

// Mutation procedures
publicProcedure
  .input(CreateUserSchema)
  .mutation(({ input }) => {
    return createUser(input)
  })
```

**Search patterns:**
```bash
grep -rn "\.query\s*(" --include="*.ts"
grep -rn "\.mutation\s*(" --include="*.ts"
grep -rn "router\s*({" --include="*.ts"
grep -rn "publicProcedure\|protectedProcedure" --include="*.ts"
```

### Next.js API Routes (App Router)

```typescript
// app/api/users/route.ts
export async function GET(request: Request) { }
export async function POST(request: Request) { }
export async function PUT(request: Request) { }
export async function PATCH(request: Request) { }
export async function DELETE(request: Request) { }
```

**Search patterns:**
```bash
find . -path "*/api/*" -name "route.ts" -o -path "*/api/*" -name "route.js"
grep -rn "export.*async.*function\s*\(GET\|POST\|PUT\|PATCH\|DELETE\)" --include="*.ts"
```

### Next.js API Routes (Pages Router)

```typescript
// pages/api/users.ts
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') { }
  if (req.method === 'GET') { }
}
```

**Search patterns:**
```bash
find . -path "*/pages/api/*" -name "*.ts" -o -path "*/pages/api/*" -name "*.js"
grep -rn "req\.method\s*===\s*" --include="*.ts"
```

### Hono

```typescript
const app = new Hono()
app.get('/api/users', handler)
app.post('/api/users', handler)
app.route('/api', apiRoutes)
```

**Search patterns:**
```bash
grep -rn "new Hono()" --include="*.ts"
grep -rn "\.get\s*(\|\.post\s*(\|\.put\s*(\|\.delete\s*(" --include="*.ts" | grep -v node_modules
```

---

## Database Operations

### Drizzle ORM

```typescript
// Select
const users = await db.select().from(usersTable)
const user = await db.select().from(usersTable).where(eq(usersTable.id, id))

// Insert
await db.insert(usersTable).values({ name, email })

// Update
await db.update(usersTable).set({ name }).where(eq(usersTable.id, id))

// Delete
await db.delete(usersTable).where(eq(usersTable.id, id))

// Table definitions
export const usersTable = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name'),
})
```

**Search patterns:**
```bash
grep -rn "db\.select\|db\.insert\|db\.update\|db\.delete" --include="*.ts"
grep -rn "from\s*(" --include="*.ts" | grep -v "import"
grep -rn "pgTable\|sqliteTable\|mysqlTable" --include="*.ts"
```

### Prisma

```typescript
// Create
await prisma.user.create({ data: { name, email } })

// Read
const user = await prisma.user.findUnique({ where: { id } })
const users = await prisma.user.findMany()

// Update
await prisma.user.update({ where: { id }, data: { name } })

// Delete
await prisma.user.delete({ where: { id } })
```

**Search patterns:**
```bash
grep -rn "prisma\.[a-z]*\.\(create\|findUnique\|findFirst\|findMany\|update\|delete\|upsert\)" --include="*.ts"
```

### TypeORM

```typescript
// Repository pattern
const user = await userRepository.findOne({ where: { id } })
await userRepository.save(user)
await userRepository.delete(id)

// Query builder
await dataSource
  .createQueryBuilder()
  .insert()
  .into(User)
  .values({ name, email })
  .execute()
```

**Search patterns:**
```bash
grep -rn "Repository\|\.findOne\|\.findMany\|\.save\|\.delete" --include="*.ts"
grep -rn "createQueryBuilder" --include="*.ts"
```

### Raw SQL

```typescript
// Template literals
const result = await sql`SELECT * FROM users WHERE id = ${id}`

// Prepared statements
await db.query('SELECT * FROM users WHERE id = $1', [id])
await db.execute('INSERT INTO users (name) VALUES (?)', [name])
```

**Search patterns:**
```bash
grep -rn "SELECT\|INSERT\|UPDATE\|DELETE" --include="*.ts" --include="*.js" | grep -v node_modules
grep -rn "sql\`\|query\s*(" --include="*.ts"
```

---

## Event Systems

### Custom Event Bus

```typescript
// Publishing
eventBus.publish('OrderPlaced', { orderId, userId })
eventBus.emit('UserCreated', userData)
events.dispatch('PaymentProcessed', paymentData)

// Subscribing
eventBus.subscribe('OrderPlaced', handler)
eventBus.on('UserCreated', handler)
events.listen('PaymentProcessed', handler)
```

**Search patterns:**
```bash
grep -rn "\.publish\s*(\|\.emit\s*(\|\.dispatch\s*(" --include="*.ts"
grep -rn "\.subscribe\s*(\|\.on\s*(\|\.listen\s*(" --include="*.ts"
grep -rn "EventBus\|EventEmitter" --include="*.ts"
```

### Kafka

```typescript
// Producer
await producer.send({
  topic: 'orders',
  messages: [{ value: JSON.stringify(order) }]
})

// Consumer
await consumer.subscribe({ topic: 'orders' })
await consumer.run({
  eachMessage: async ({ topic, partition, message }) => { }
})
```

**Search patterns:**
```bash
grep -rn "producer\.send\|\.send\s*({.*topic" --include="*.ts"
grep -rn "consumer\.subscribe\|consumer\.run" --include="*.ts"
grep -rn "KafkaJS\|Kafka\(" --include="*.ts"
```

### Redis Pub/Sub

```typescript
// Publishing
await redis.publish('channel', message)

// Subscribing
await redis.subscribe('channel')
redis.on('message', (channel, message) => { })
```

**Search patterns:**
```bash
grep -rn "redis\.publish\|\.publish\s*(" --include="*.ts" | grep -i redis
grep -rn "redis\.subscribe\|\.subscribe\s*(" --include="*.ts" | grep -i redis
```

### AWS SQS/SNS

```typescript
// SQS
await sqs.sendMessage({ QueueUrl, MessageBody })
await sqs.receiveMessage({ QueueUrl })

// SNS
await sns.publish({ TopicArn, Message })
```

**Search patterns:**
```bash
grep -rn "sendMessage\|receiveMessage" --include="*.ts" | grep -i sqs
grep -rn "\.publish\s*({.*TopicArn" --include="*.ts"
```

### Inngest

```typescript
// Define function
export const processOrder = inngest.createFunction(
  { id: 'process-order' },
  { event: 'order/placed' },
  async ({ event, step }) => { }
)

// Send event
await inngest.send({ name: 'order/placed', data: { orderId } })
```

**Search patterns:**
```bash
grep -rn "inngest\.createFunction\|createFunction\s*(" --include="*.ts"
grep -rn "inngest\.send\|\.send\s*({.*name:" --include="*.ts"
grep -rn "event:\s*['\"]" --include="*.ts"
```

---

## External API Calls

### Fetch API

```typescript
const response = await fetch('https://api.example.com/users', {
  method: 'POST',
  body: JSON.stringify(data)
})
```

**Search patterns:**
```bash
grep -rn "fetch\s*(\s*['\"\`]https\?://" --include="*.ts" --include="*.js"
grep -rn "fetch\s*(" --include="*.ts"
```

### Axios

```typescript
const response = await axios.get('https://api.example.com/users')
await axios.post('https://api.example.com/orders', data)

// Instance
const client = axios.create({ baseURL: 'https://api.example.com' })
await client.get('/users')
```

**Search patterns:**
```bash
grep -rn "axios\.\(get\|post\|put\|patch\|delete\)" --include="*.ts"
grep -rn "axios\.create" --include="*.ts"
```

### SDK Clients

```typescript
// Stripe
const stripe = new Stripe(apiKey)
await stripe.customers.create({ email })
await stripe.paymentIntents.create({ amount, currency })

// Twilio
const twilio = require('twilio')(accountSid, authToken)
await twilio.messages.create({ to, from, body })

// SendGrid
await sgMail.send({ to, from, subject, text })
```

**Search patterns:**
```bash
grep -rn "new Stripe\|stripe\." --include="*.ts"
grep -rn "twilio\|Twilio" --include="*.ts"
grep -rn "sgMail\|sendgrid\|SendGrid" --include="*.ts"
```

---

## Framework-Specific Patterns

### Effect-TS Services

```typescript
// Service definition
export class UserService extends Context.Tag("UserService")<UserService, {
  create: (data: CreateUserInput) => Effect.Effect<User, UserError>
  findById: (id: string) => Effect.Effect<User, UserNotFoundError>
}>() {}

// Implementation
export const UserServiceLive = Layer.succeed(
  UserService,
  {
    create: (data) => pipe(
      Effect.promise(() => db.insert(users).values(data)),
      Effect.map(([user]) => user)
    ),
    findById: (id) => pipe(
      Effect.promise(() => db.select().from(users).where(eq(users.id, id))),
      Effect.flatMap((result) =>
        result ? Effect.succeed(result) : Effect.fail(new UserNotFoundError(id))
      )
    )
  }
)
```

**Search patterns:**
```bash
grep -rn "Context\.Tag\|extends.*Tag" --include="*.ts"
grep -rn "Layer\.succeed\|Layer\.effect" --include="*.ts"
grep -rn "Effect\.promise\|Effect\.sync" --include="*.ts"
```

### Zod Schemas

```typescript
// Input validation
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8)
})

// Type inference
type CreateUserInput = z.infer<typeof CreateUserSchema>
```

**Search patterns:**
```bash
grep -rn "z\.object\|z\.array\|z\.string\|z\.number" --include="*.ts"
grep -rn "Schema\s*=\s*z\." --include="*.ts"
```

---

---

# Python Patterns

## API Endpoints

### Flask

```python
# Route decorators
@app.route('/api/users', methods=['GET'])
@app.route('/api/users', methods=['POST'])
@app.route('/api/users/<int:id>', methods=['PUT'])

# Blueprint routes
@blueprint.route('/users', methods=['GET'])
```

**Search patterns:**
```bash
grep -rn "@app\.route\|@blueprint\.route" --include="*.py"
grep -rn "methods=\[" --include="*.py"
```

### FastAPI

```python
# Route decorators
@app.get("/api/users")
@app.post("/api/users")
@app.put("/api/users/{user_id}")
@app.delete("/api/users/{user_id}")

# Router decorators
@router.get("/users")
@router.post("/users")
```

**Search patterns:**
```bash
grep -rn "@app\.\(get\|post\|put\|patch\|delete\)\|@router\.\(get\|post\|put\|patch\|delete\)" --include="*.py"
```

### Django

```python
# URL patterns
path('api/users/', views.user_list, name='user-list')
path('api/users/<int:pk>/', views.user_detail, name='user-detail')

# Class-based views
class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
```

**Search patterns:**
```bash
grep -rn "path\s*(\|re_path\s*(" --include="*.py" | grep -i api
grep -rn "ViewSet\|APIView\|GenericAPIView" --include="*.py"
```

## Database Operations

### SQLAlchemy

```python
# Query operations
session.query(User).filter_by(id=id).first()
session.add(user)
session.commit()

# ORM models
class User(Base):
    __tablename__ = 'users'
```

**Search patterns:**
```bash
grep -rn "session\.query\|session\.add\|session\.commit\|session\.delete" --include="*.py"
grep -rn "__tablename__\|Base\s*)" --include="*.py"
```

### Django ORM

```python
# Query operations
User.objects.filter(id=id)
User.objects.create(name=name)
user.save()
user.delete()
```

**Search patterns:**
```bash
grep -rn "\.objects\.\(filter\|get\|create\|all\|delete\)" --include="*.py"
grep -rn "\.save()\|\.delete()" --include="*.py"
```

## Events

### Celery

```python
# Task definition
@celery.task
def process_order(order_id):
    pass

# Task invocation
process_order.delay(order_id)
process_order.apply_async(args=[order_id])
```

**Search patterns:**
```bash
grep -rn "@celery\.task\|@shared_task\|\.delay(\|\.apply_async(" --include="*.py"
```

---

# Go Patterns

## API Endpoints

### Standard Library (net/http)

```go
// HandleFunc patterns
http.HandleFunc("/api/users", usersHandler)
mux.HandleFunc("/api/users", usersHandler)

// Handler registration
http.Handle("/api/", apiHandler)
```

**Search patterns:**
```bash
grep -rn "HandleFunc\|Handle\s*(" --include="*.go"
grep -rn "http\.Get\|http\.Post\|http\.NewRequest" --include="*.go"
```

### Gin

```go
// Route registration
r.GET("/api/users", getUsers)
r.POST("/api/users", createUser)
r.PUT("/api/users/:id", updateUser)
r.DELETE("/api/users/:id", deleteUser)

// Route groups
api := r.Group("/api")
api.GET("/users", getUsers)
```

**Search patterns:**
```bash
grep -rn "\.GET\|\.POST\|\.PUT\|\.PATCH\|\.DELETE" --include="*.go"
grep -rn "\.Group(" --include="*.go"
```

### Echo

```go
// Route registration
e.GET("/api/users", getUsers)
e.POST("/api/users", createUser)

// Groups
g := e.Group("/api")
g.GET("/users", getUsers)
```

**Search patterns:**
```bash
grep -rn "e\.GET\|e\.POST\|e\.PUT\|e\.DELETE" --include="*.go"
```

### Chi

```go
// Route registration
r.Get("/api/users", getUsers)
r.Post("/api/users", createUser)

// Subrouters
r.Route("/api", func(r chi.Router) {
    r.Get("/users", getUsers)
})
```

**Search patterns:**
```bash
grep -rn "r\.Get\|r\.Post\|r\.Put\|r\.Delete\|r\.Route" --include="*.go"
```

## Database Operations

### GORM

```go
// Query operations
db.Find(&users)
db.First(&user, id)
db.Create(&user)
db.Save(&user)
db.Delete(&user)

// Model definition
type User struct {
    gorm.Model
    Name string
}
```

**Search patterns:**
```bash
grep -rn "db\.Find\|db\.First\|db\.Create\|db\.Save\|db\.Delete\|db\.Where" --include="*.go"
grep -rn "gorm\.Model" --include="*.go"
```

### database/sql

```go
// Query operations
db.Query("SELECT * FROM users")
db.QueryRow("SELECT * FROM users WHERE id = ?", id)
db.Exec("INSERT INTO users (name) VALUES (?)", name)
```

**Search patterns:**
```bash
grep -rn "db\.Query\|db\.QueryRow\|db\.Exec\|sql\.Open" --include="*.go"
```

---

# Rust Patterns

## API Endpoints

### Actix-web

```rust
// Route handlers with macros
#[get("/api/users")]
async fn get_users() -> impl Responder { }

#[post("/api/users")]
async fn create_user(body: web::Json<User>) -> impl Responder { }

// Manual registration
web::resource("/api/users")
    .route(web::get().to(get_users))
    .route(web::post().to(create_user))
```

**Search patterns:**
```bash
grep -rn "#\[get\|#\[post\|#\[put\|#\[patch\|#\[delete" --include="*.rs"
grep -rn "web::resource\|web::get\|web::post" --include="*.rs"
```

### Axum

```rust
// Route registration
let app = Router::new()
    .route("/api/users", get(get_users).post(create_user))
    .route("/api/users/:id", get(get_user).put(update_user));
```

**Search patterns:**
```bash
grep -rn "Router::new\|\.route(" --include="*.rs"
grep -rn "get(\|post(\|put(\|delete(" --include="*.rs"
```

### Rocket

```rust
// Route macros
#[get("/api/users")]
fn get_users() -> Json<Vec<User>> { }

#[post("/api/users", data = "<user>")]
fn create_user(user: Json<User>) -> Json<User> { }
```

**Search patterns:**
```bash
grep -rn "#\[get\|#\[post\|#\[put\|#\[patch\|#\[delete" --include="*.rs"
```

## Database Operations

### Diesel

```rust
// Query operations
users.filter(id.eq(user_id)).first::<User>(&conn)
diesel::insert_into(users).values(&new_user).execute(&conn)
diesel::update(users.find(id)).set(name.eq(new_name)).execute(&conn)
diesel::delete(users.find(id)).execute(&conn)
```

**Search patterns:**
```bash
grep -rn "diesel::insert_into\|diesel::update\|diesel::delete\|\.filter(\|\.first::" --include="*.rs"
```

### SQLx

```rust
// Query macros
sqlx::query!("SELECT * FROM users WHERE id = $1", id)
sqlx::query_as!(User, "SELECT * FROM users")
```

**Search patterns:**
```bash
grep -rn "sqlx::query\|query_as!\|query!" --include="*.rs"
```

---

# Java Patterns

## API Endpoints

### Spring Boot

```java
// Controller annotations
@GetMapping("/api/users")
@PostMapping("/api/users")
@PutMapping("/api/users/{id}")
@DeleteMapping("/api/users/{id}")

// RequestMapping
@RequestMapping(value = "/api/users", method = RequestMethod.GET)

// RestController class
@RestController
@RequestMapping("/api")
public class UserController { }
```

**Search patterns:**
```bash
grep -rn "@GetMapping\|@PostMapping\|@PutMapping\|@PatchMapping\|@DeleteMapping" --include="*.java"
grep -rn "@RequestMapping\|@RestController" --include="*.java"
```

### Quarkus

```java
// JAX-RS annotations
@GET
@Path("/api/users")
public List<User> getUsers() { }

@POST
@Path("/api/users")
public User createUser(User user) { }
```

**Search patterns:**
```bash
grep -rn "@GET\|@POST\|@PUT\|@DELETE\|@Path" --include="*.java"
```

## Database Operations

### JPA/Hibernate

```java
// Repository methods
userRepository.findById(id)
userRepository.save(user)
userRepository.delete(user)
userRepository.findAll()

// Entity annotation
@Entity
@Table(name = "users")
public class User { }
```

**Search patterns:**
```bash
grep -rn "Repository\|\.findById\|\.save(\|\.delete(\|\.findAll" --include="*.java"
grep -rn "@Entity\|@Table" --include="*.java"
```

### JDBC

```java
// Query execution
statement.executeQuery("SELECT * FROM users")
preparedStatement.executeUpdate()
jdbcTemplate.query("SELECT * FROM users", rowMapper)
```

**Search patterns:**
```bash
grep -rn "executeQuery\|executeUpdate\|jdbcTemplate" --include="*.java"
```

## Events

### Spring Events

```java
// Publishing
applicationEventPublisher.publishEvent(new OrderCreatedEvent(order))

// Listening
@EventListener
public void handleOrderCreated(OrderCreatedEvent event) { }
```

**Search patterns:**
```bash
grep -rn "publishEvent\|@EventListener\|ApplicationEvent" --include="*.java"
```

---

# Ruby Patterns

## API Endpoints

### Rails

```ruby
# Routes
get '/api/users', to: 'users#index'
post '/api/users', to: 'users#create'
resources :users, path: '/api/users'

# Controller actions
def index; end
def create; end
def show; end
def update; end
def destroy; end
```

**Search patterns:**
```bash
grep -rn "get\s*['\"]\/\|post\s*['\"]\/\|put\s*['\"]\/\|delete\s*['\"]\/\|resources\s*:" --include="*.rb"
grep -rn "def\s*\(index\|create\|show\|update\|destroy\)" --include="*.rb"
```

### Sinatra

```ruby
# Route definitions
get '/api/users' do; end
post '/api/users' do; end
put '/api/users/:id' do; end
delete '/api/users/:id' do; end
```

**Search patterns:**
```bash
grep -rn "get\s*['\"]\/\|post\s*['\"]\/\|put\s*['\"]\/\|delete\s*['\"]\/\|patch\s*['\"]" --include="*.rb"
```

## Database Operations

### ActiveRecord

```ruby
# Query operations
User.find(id)
User.where(name: name)
User.create(name: name)
user.save
user.update(name: new_name)
user.destroy

# Model definition
class User < ApplicationRecord
  belongs_to :organization
  has_many :orders
end
```

**Search patterns:**
```bash
grep -rn "\.find(\|\.where(\|\.create(\|\.save\|\.update(\|\.destroy" --include="*.rb"
grep -rn "class.*<.*ApplicationRecord\|ActiveRecord::Base" --include="*.rb"
```

## Events

### Sidekiq

```ruby
# Job definition
class ProcessOrderJob
  include Sidekiq::Job
  def perform(order_id); end
end

# Job invocation
ProcessOrderJob.perform_async(order_id)
ProcessOrderJob.perform_in(1.hour, order_id)
```

**Search patterns:**
```bash
grep -rn "include Sidekiq\|perform_async\|perform_in\|perform_at" --include="*.rb"
```

---

# C# Patterns

## API Endpoints

### ASP.NET Core Controllers

```csharp
// Controller attributes
[HttpGet("api/users")]
[HttpPost("api/users")]
[HttpPut("api/users/{id}")]
[HttpDelete("api/users/{id}")]

// Controller class
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase { }
```

**Search patterns:**
```bash
grep -rn "\[HttpGet\|\[HttpPost\|\[HttpPut\|\[HttpPatch\|\[HttpDelete" --include="*.cs"
grep -rn "\[ApiController\]\|\[Route(" --include="*.cs"
```

### Minimal APIs

```csharp
// Endpoint mapping
app.MapGet("/api/users", GetUsers);
app.MapPost("/api/users", CreateUser);
app.MapPut("/api/users/{id}", UpdateUser);
app.MapDelete("/api/users/{id}", DeleteUser);
```

**Search patterns:**
```bash
grep -rn "app\.MapGet\|app\.MapPost\|app\.MapPut\|app\.MapDelete" --include="*.cs"
```

## Database Operations

### Entity Framework

```csharp
// DbContext operations
context.Users.ToList();
context.Users.Find(id);
context.Users.Add(user);
context.SaveChanges();
context.Users.Remove(user);

// Entity definition
public class User
{
    public int Id { get; set; }
    public string Name { get; set; }
}

// DbContext
public class AppDbContext : DbContext
{
    public DbSet<User> Users { get; set; }
}
```

**Search patterns:**
```bash
grep -rn "DbContext\|DbSet<\|\.SaveChanges\|\.Add(\|\.Remove(\|\.Find(" --include="*.cs"
```

### Dapper

```csharp
// Query execution
connection.Query<User>("SELECT * FROM Users");
connection.Execute("INSERT INTO Users (Name) VALUES (@Name)", user);
```

**Search patterns:**
```bash
grep -rn "connection\.Query\|connection\.Execute\|\.QueryAsync\|\.ExecuteAsync" --include="*.cs"
```

## Events

### MassTransit

```csharp
// Publishing
await publishEndpoint.Publish(new OrderCreated { OrderId = id });

// Consuming
public class OrderCreatedConsumer : IConsumer<OrderCreated>
{
    public async Task Consume(ConsumeContext<OrderCreated> context) { }
}
```

**Search patterns:**
```bash
grep -rn "\.Publish(\|IConsumer<\|ConsumeContext<" --include="*.cs"
```

---

## Tips for Effective Discovery

1. **Start with technology detection** - Identify languages and frameworks first

2. **Use universal patterns first** - SQL keywords and HTTP methods work everywhere

3. **Start broad, then narrow** - Use general patterns first, then refine based on what you find

4. **Follow the imports** - When you find a handler, check its imports to find services and utilities

5. **Check configuration files** - `package.json`, `go.mod`, `Cargo.toml`, etc. reveal frameworks in use

6. **Look for types/models** - Type definitions often reveal contract shapes

7. **Check tests** - Test files often reveal expected behavior and edge cases

8. **Read README files** - Module READMEs often document contracts informally

9. **Check for OpenAPI/Swagger** - Many APIs have formal spec files

10. **Look for event schemas** - Events often have dedicated schema files

11. **Fall back to interview** - If patterns don't match, ask the user about their conventions
