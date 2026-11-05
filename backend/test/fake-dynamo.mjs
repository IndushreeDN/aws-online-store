// A very small pretend DynamoDB that lives in memory, so tests run with no AWS and no internet.
// It understands ONLY the few commands and expressions our code uses. Anything else throws,
// so a test can never pass by accident because the fake silently ignored something.

function clone(value) {
  return structuredClone(value);
}

function awsError(name, message, extra = {}) {
  const err = new Error(message);
  err.name = name;
  Object.assign(err, extra);
  return err;
}

export class FakeDynamo {
  constructor(keys) {
    // keys: { tableName: ["partitionKey", "sortKey?"] }
    this.keys = keys;
    this.tables = Object.fromEntries(Object.keys(keys).map((t) => [t, new Map()]));
  }

  keyOf(table, item) {
    return this.keys[table].map((k) => String(item[k])).join("\u0000");
  }

  put(table, item) {
    this.tables[table].set(this.keyOf(table, item), clone(item));
  }

  all(table) {
    return [...this.tables[table].values()].map(clone);
  }

  find(table, key) {
    return this.tables[table].get(this.keyOf(table, key));
  }

  // Evaluates conditions such as "attribute_exists(productId) AND #stock >= :qty".
  checkCondition(item, input) {
    const expr = input.ConditionExpression;
    if (!expr) return true;
    const names = input.ExpressionAttributeNames ?? {};
    const values = input.ExpressionAttributeValues ?? {};
    const attr = (token) => names[token] ?? token;
    return expr.split(" AND ").every((clause) => {
      let m;
      if ((m = clause.match(/^attribute_exists\((\S+)\)$/))) return item !== undefined && attr(m[1]) in item;
      if ((m = clause.match(/^attribute_not_exists\((\S+)\)$/))) return item === undefined || !(attr(m[1]) in item);
      if ((m = clause.match(/^(\S+) >= (:\w+)$/))) return item !== undefined && item[attr(m[1])] >= values[m[2]];
      throw new Error(`FakeDynamo does not understand the condition: ${clause}`);
    });
  }

  // Applies "SET a = :x, b = c - :y".
  applyUpdate(existing, input) {
    const names = input.ExpressionAttributeNames ?? {};
    const values = input.ExpressionAttributeValues ?? {};
    const attr = (token) => names[token] ?? token;
    const expr = input.UpdateExpression;
    if (!expr.startsWith("SET ")) throw new Error(`FakeDynamo only understands SET: ${expr}`);
    const next = existing ? clone(existing) : { ...clone(input.Key) };
    for (const part of expr.slice(4).split(", ")) {
      let m;
      if ((m = part.match(/^(\S+) = (:\w+)$/))) {
        next[attr(m[1])] = clone(values[m[2]]);
      } else if ((m = part.match(/^(\S+) = (\S+) - (:\w+)$/))) {
        next[attr(m[1])] = next[attr(m[2])] - values[m[3]];
      } else {
        throw new Error(`FakeDynamo does not understand the update: ${part}`);
      }
    }
    return next;
  }

  async send(command) {
    const type = command.constructor.name;
    const input = command.input;

    switch (type) {
      case "ScanCommand":
        return { Items: this.all(input.TableName) };

      case "GetCommand": {
        const item = this.find(input.TableName, input.Key);
        return item ? { Item: clone(item) } : {};
      }

      case "BatchGetCommand": {
        const responses = {};
        for (const [table, req] of Object.entries(input.RequestItems)) {
          responses[table] = req.Keys.map((k) => this.find(table, k)).filter(Boolean).map(clone);
        }
        return { Responses: responses, UnprocessedKeys: {} };
      }

      case "QueryCommand": {
        if (input.KeyConditionExpression !== "userId = :u") {
          throw new Error(`FakeDynamo does not understand the query: ${input.KeyConditionExpression}`);
        }
        let items = this.all(input.TableName).filter((i) => i.userId === input.ExpressionAttributeValues[":u"]);
        items.sort((a, b) => String(a.orderId).localeCompare(String(b.orderId)));
        if (input.ScanIndexForward === false) items.reverse();
        if (input.Limit) items = items.slice(0, input.Limit);
        return { Items: items };
      }

      case "PutCommand": {
        const existing = this.find(input.TableName, input.Item);
        if (!this.checkCondition(existing, input)) {
          throw awsError("ConditionalCheckFailedException", "The conditional request failed");
        }
        this.put(input.TableName, input.Item);
        return {};
      }

      case "UpdateCommand": {
        const existing = this.find(input.TableName, input.Key);
        if (!this.checkCondition(existing, input)) {
          throw awsError("ConditionalCheckFailedException", "The conditional request failed");
        }
        const next = this.applyUpdate(existing, input);
        this.put(input.TableName, next);
        return input.ReturnValues === "ALL_NEW" ? { Attributes: clone(next) } : {};
      }

      case "TransactWriteCommand": {
        // All-or-nothing: check every condition first, change things only if all pass.
        const reasons = input.TransactItems.map((t) => {
          const op = t.Put ?? t.Update;
          const key = t.Put ? t.Put.Item : t.Update.Key;
          const ok = this.checkCondition(this.find(op.TableName, key), op);
          return { Code: ok ? "None" : "ConditionalCheckFailed" };
        });
        if (reasons.some((r) => r.Code !== "None")) {
          throw awsError("TransactionCanceledException", "Transaction cancelled", {
            CancellationReasons: reasons,
          });
        }
        for (const t of input.TransactItems) {
          if (t.Put) this.put(t.Put.TableName, t.Put.Item);
          else {
            const existing = this.find(t.Update.TableName, t.Update.Key);
            this.put(t.Update.TableName, this.applyUpdate(existing, t.Update));
          }
        }
        return {};
      }

      default:
        throw new Error(`FakeDynamo does not understand the command: ${type}`);
    }
  }
}
