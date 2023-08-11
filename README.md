# lamda-express

Use like express, but with lambda.

```javascript
const express = require('lambda_express');

const app = express();

app.get('/',(req, res) => {
  console.log("/ handler");
  res.send('Hello world');
});

exports.handler = app.handler;

```
