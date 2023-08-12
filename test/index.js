const crypto = require('node:crypto');
const express = require('../src');

const app = express();

const router = new express.Router();
const router2 = new express.Router();

app.set('foobar', 1);

console.log('foobar:', app.get('foobar'));

app.use((req, res, next) => {
  console.log('everything');
  next();
});

app.use('/', (req, res, next) => {
  console.log('prefix /');
  next();
});

app.all('/foo', (req, res) => {
  res.set('foo', 'bar');
  res.header('Content-Type', 'application/json');
  res.status(201).send('{ "201": "ok" }');
});
app.all('/sendStatus', (req, res) => {
  res.sendStatus(418);
});

app.all('/params/:bar/:baz', (req, res) => {
  res.send({
    route: '/params/:bar/:baz',
    params: req.params,
    body: req.body,
    uuid: crypto.randomUUID(),
  });
});

app.all('/params2/:bar.baz', (req, res) => {
  res.send({
    route: '/params/:bar.baz',
    params: req.params,
    body: req.body,
    uuid: crypto.randomUUID(),
  });
});

app.put('/put', (req, res) => {
  res.send({ params: req.params, body: req.body, uuid: crypto.randomUUID() });
});

app.get('/', (req, res) => {
  res.send({ params: req.params, body: req.body, uuid: crypto.randomUUID() });
});

app.get('/err', (req, res, next) => {
  next(new Error('foo'));
});

router.all('/foo', (req, res) => {
  console.log('subrouter /foo');
  res.send({ route: 'sub /foo', uuid: crypto.randomUUID() });
});

router.get('/fooget', (req, res) => {
  console.log('subrouter /fooget');
  res.send({ route: 'sub /fooget', uuid: crypto.randomUUID() });
});

router2.all('/baz2', (req, res) => {
  console.log('subrouter2 /baz2');
  res.send({ route: 'subrouter2 /baz2', uuid: crypto.randomUUID() });
});

router.use('/sub2', router2);

app.use('/sub', router);

router2.all('/baz', (req, res) => {
  console.log('subrouter2 /baz');
  res.send({ route: 'subrouter2 /baz', uuid: crypto.randomUUID() });
});

app.use((err, req, res, next) => {
  console.log('error handler:', err);
  res.sendStatus(500);
});

if (process.env.REAL) {
  console.log('REAL');
  app.listen(process.env.PORT || 3001);
} else {
  console.log('Exporting handler2');
  app._middleware.forEach((item) => console.log(item?.match?.regex));
  exports.handler = app.handler;
}
