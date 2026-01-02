- Dynamic model selection based on perceived test complexity. 
  - If high: Opus (brand new tests with no existing references)
  - If Medium: Sonnet (some examples, new mocks etc)
  - If low: Haiku (lots of existing examples / cases)


- Theres a bug where the reasoning time is accumulating across all thought. They are not isolated to that instance. Chain of thought should end when that current thought ends, not when the stream ends.

- When cancelling the stream, we are not marking the active in progress queue item as cancelled

- Regression aware: The Agent should know when current changes may have regressed existing test suites and understand if this is an expected regression or a side effect that must be reconciled. 