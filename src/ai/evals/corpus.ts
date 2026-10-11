import type { DiagramOp } from "../index";
export interface ExpectedGraph {
  nodes: { label: string; stencil: string }[];
  edges: [string, string][];
}
export interface EvalTurn {
  ops: DiagramOp[];
  expected: ExpectedGraph;
}
export interface DiagramEval {
  description: string;
  turns: EvalTurn[];
}

// Descriptions are reusable prompts; ops record the semantic extraction expected from a frontend.
const flows: [string, [string, string, string][]][] = [
  [
    "Kafka topic orders.created consumed by a .NET consumer billing-worker which writes to Postgres",
    [
      ["Kafka topic", "orders.created", "kafka.topic"],
      [".NET consumer", "billing-worker", "service.dotnet"],
      ["Postgres", "billing-db", "postgres"],
    ],
  ],
  [
    "Azure App Configuration resolves secrets through Key Vault",
    [
      ["Azure App Configuration", "App Configuration", "generic.service"],
      ["Key Vault", "Secrets", "azure.key-vault"],
    ],
  ],
  [
    "A browser calls a Node.js API",
    [
      ["browser", "Web", "client.browser"],
      ["Node.js", "API", "service.node"],
    ],
  ],
  [
    "A Python job writes to pg",
    [
      ["Python service", "Indexer", "service.python"],
      ["pg", "Index", "postgres"],
    ],
  ],
  [
    "Java consumes a Kafka topic",
    [
      ["Kafka topic", "Events", "kafka.topic"],
      ["Java", "Worker", "service.java"],
    ],
  ],
  [
    "An Azure function consumes a Service Bus queue",
    [
      ["Service Bus queue", "Jobs", "azure.service-bus.queue"],
      ["Azure Functions", "Job runner", "azure.functions"],
    ],
  ],
  [
    "SQS invokes Lambda",
    [
      ["SQS", "Inbox", "aws.sqs"],
      ["Lambda", "Handler", "aws.lambda"],
    ],
  ],
  [
    "SNS fans out toward SQS",
    [
      ["SNS", "Notifications", "aws.sns"],
      ["SQS", "Mail queue", "aws.sqs"],
    ],
  ],
  [
    "Kinesis feeds a processor",
    [
      ["Kinesis", "Stream", "aws.kinesis"],
      ["service.go", "Processor", "service.go"],
    ],
  ],
  [
    "PubSub feeds Python",
    [
      ["gcp.pubsub", "Bus", "gcp.pubsub"],
      ["Python", "Consumer", "service.python"],
    ],
  ],
  [
    "A .NET API stores documents in MongoDB",
    [
      [".NET", "API", "service.dotnet"],
      ["MongoDB", "Documents", "mongodb"],
    ],
  ],
  [
    "A Go service uses Redis cache",
    [
      ["service.go", "API", "service.go"],
      ["redis.cache", "Cache", "redis.cache"],
    ],
  ],
  [
    "A Lambda saves objects into S3",
    [
      ["Lambda", "Uploader", "aws.lambda"],
      ["S3", "Objects", "aws.s3"],
    ],
  ],
  [
    "A .NET service writes Azure SQL",
    [
      ["service.dotnet", "Writer", "service.dotnet"],
      ["Azure SQL", "Database", "azure.sql"],
    ],
  ],
  [
    "Container Apps accesses Cosmos DB",
    [
      ["Container Apps", "API", "azure.container-apps"],
      ["Cosmos DB", "State", "azure.cosmos-db"],
    ],
  ],
  [
    "A mobile client calls an API gateway",
    [
      ["mobile", "Mobile", "client.mobile"],
      ["aws.api-gateway", "Gateway", "aws.api-gateway"],
    ],
  ],
  [
    "Front Door routes to App Service",
    [
      ["Front Door", "Ingress", "azure.front-door"],
      ["App Service", "Web app", "azure.app-service"],
    ],
  ],
  [
    "RabbitMQ routes to a Java worker",
    [
      ["rabbitmq.queue", "Tasks", "rabbitmq.queue"],
      ["service.java", "Worker", "service.java"],
    ],
  ],
  [
    "Prometheus exports to Grafana",
    [
      ["Prometheus", "Metrics", "prometheus"],
      ["Grafana", "Dashboards", "grafana"],
    ],
  ],
  [
    "OpenTelemetry sends to Datadog",
    [
      ["OpenTelemetry", "Collector", "opentelemetry"],
      ["Datadog", "Telemetry", "datadog"],
    ],
  ],
  [
    "IoT devices publish into Event Hubs",
    [
      ["IoT", "Sensors", "client.iot"],
      ["Event Hubs", "Measurements", "azure.event-hubs"],
    ],
  ],
  [
    "A scheduler starts a .NET worker",
    [
      ["generic.scheduler", "Timer", "generic.scheduler"],
      ["service.dotnet", "Worker", "service.dotnet"],
    ],
  ],
  [
    "An external partner sends a webhook",
    [
      ["client.partner", "Partner", "client.partner"],
      ["generic.webhook", "Hook", "generic.webhook"],
    ],
  ],
  [
    "A service delivers email",
    [
      ["generic.service", "Notifications", "generic.service"],
      ["generic.email", "Email", "generic.email"],
    ],
  ],
  [
    "An ECS workload persists to DynamoDB",
    [
      ["aws.ecs", "Service", "aws.ecs"],
      ["DynamoDB", "Table", "aws.dynamodb"],
    ],
  ],
  [
    "A Docker service writes to Elasticsearch",
    [
      ["docker.container", "Indexer", "docker.container"],
      ["Elasticsearch", "Search", "elasticsearch"],
    ],
  ],
  [
    "A deployment forwards to a pod",
    [
      ["k8s.deployment", "Deployment", "k8s.deployment"],
      ["k8s.pod", "Pod", "k8s.pod"],
    ],
  ],
  [
    "An unspecified component connects to a generic database",
    [
      ["unrecognized frobnicator", "Component", "generic.service"],
      ["generic.database", "Database", "generic.database"],
    ],
  ],
];
export const diagramEvals: DiagramEval[] = flows.map(([description, nodes]) => ({
  description,
  turns: [
    {
      ops: [
        ...nodes.map(([kind, label], i): DiagramOp => ({ op: "add_node", kind, label, key: `n${i}` })),
        ...nodes.slice(1).map((_, i): DiagramOp => ({
          op: "connect",
          from: `n${i}`,
          to: `n${i + 1}`,
          kind: i === nodes.length - 2 && nodes[nodes.length - 1][2] === "postgres" ? "sync" : "async",
        })),
      ],
      expected: {
        nodes: nodes.map(([, label, stencil]) => ({ label, stencil })),
        edges: nodes.slice(1).map(([, label], i) => [nodes[i][1], label]),
      },
    },
  ],
}));
diagramEvals.push({
  description: "Publish an event to billing and shipping consumers inside an Azure boundary",
  turns: [
    {
      ops: [
        { op: "add_node", kind: "Kafka topic", label: "Orders", key: "topic" },
        { op: "add_node", kind: ".NET", label: "Billing", key: "billing" },
        { op: "add_node", kind: "Python", label: "Shipping", key: "shipping" },
        { op: "connect", from: "topic", to: "billing" },
        { op: "connect", from: "topic", to: "shipping" },
        { op: "add_boundary", label: "Azure", members: ["billing", "shipping"], tone: "azure" },
      ],
      expected: {
        nodes: [
          { label: "Orders", stencil: "kafka.topic" },
          { label: "Billing", stencil: "service.dotnet" },
          { label: "Shipping", stencil: "service.python" },
        ],
        edges: [
          ["Orders", "Billing"],
          ["Orders", "Shipping"],
        ],
      },
    },
  ],
});
diagramEvals.push({
  description: "Add an API and database, rename the API, insert a worker between them, then remove the worker",
  turns: [
    {
      ops: [
        { op: "add_node", kind: ".NET", label: "API", key: "a" },
        { op: "add_node", kind: "pg", label: "DB", key: "b" },
        { op: "connect", from: "a", to: "b", kind: "sync" },
      ],
      expected: {
        nodes: [
          { label: "API", stencil: "service.dotnet" },
          { label: "DB", stencil: "postgres" },
        ],
        edges: [["API", "DB"]],
      },
    },
    {
      ops: [{ op: "update", target: "API", label: "Orders API" }],
      expected: {
        nodes: [
          { label: "Orders API", stencil: "service.dotnet" },
          { label: "DB", stencil: "postgres" },
        ],
        edges: [["Orders API", "DB"]],
      },
    },
    {
      ops: [
        { op: "remove", targets: ["Orders API -> DB"] },
        { op: "add_node", kind: ".NET consumer", label: "Worker", key: "worker" },
        { op: "connect", from: "Orders API", to: "worker" },
        { op: "connect", from: "worker", to: "DB", kind: "sync" },
      ],
      expected: {
        nodes: [
          { label: "Orders API", stencil: "service.dotnet" },
          { label: "DB", stencil: "postgres" },
          { label: "Worker", stencil: "service.dotnet" },
        ],
        edges: [
          ["Orders API", "Worker"],
          ["Worker", "DB"],
        ],
      },
    },
    {
      ops: [
        { op: "remove", targets: ["Worker"] },
        { op: "connect", from: "Orders API", to: "DB", kind: "sync" },
      ],
      expected: {
        nodes: [
          { label: "Orders API", stencil: "service.dotnet" },
          { label: "DB", stencil: "postgres" },
        ],
        edges: [["Orders API", "DB"]],
      },
    },
  ],
});
