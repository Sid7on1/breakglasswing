The order-summary fixture has a failing focused test. Diagnose and fix `summarizeOrders` while
preserving its exported API. Inspect the fixture before editing, run the focused test to reproduce
the failure, make the smallest correct change, rerun the test, and verify the final source before
finishing.

The complete required contract is:

- Include every order except an order whose status is exactly `cancelled`. Orders with any other
  status are included; in particular, a `pending` order must be counted.
- Compute each included order's value by summing `quantity * unitPrice` over its `items`. Do not use
  the order's `subtotal` field.
- Group included orders by customer. Return one `{ customer, count, total }` object per customer,
  where `count` is that customer's number of included orders and `total` is the sum of their computed
  order values, rounded to two decimal places.
- Sort the returned objects by customer name ascending.
- Do not mutate the input array, any order, or any nested item.
