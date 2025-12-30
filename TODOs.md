- Break up large chain sets in to bite size chunks for the agent, create a message queue and process files in queue

- Ensure we do not progress QUEUE until the current conversation has ended and the test suite passes.

- Dynamic model selection based on perceived test complexity. 
  - If high: Opus (brand new tests with no existing references)
  - If Medium: Sonnet (some examples, new mocks etc)
  - If low: Haiku (lots of existing examples / cases)

- Ensure all test files are typesafe
