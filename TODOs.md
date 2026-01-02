- Dynamic model selection based on perceived test complexity. 
  - If high: Opus (brand new tests with no existing references)
  - If Medium: Sonnet (some examples, new mocks etc)
  - If low: Haiku (lots of existing examples / cases)


- When cancelling the stream, we are not marking the active in progress queue item as cancelled

- Regression aware: The Agent should know when current changes may have regressed existing test suites and understand if this is an expected regression or a side effect that must be reconciled.

- Theres a bug where we are sending two of the TODO messages at once and the state of the queue is corrupt