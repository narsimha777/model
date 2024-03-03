const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const pgSession = require('connect-pg-simple')(session);
const pg = require('pg');
const bodyParser = require('body-parser')
const dotenv = require('dotenv').config();
const cors = require('cors');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
// const { sign } = require('jsonwebtoken')

const app = express();

const PORT = process.env.PORT || 3000;
const pool = new pg.Pool({
  // PostgreSQL connection configuration
  connectionString: process.env.DATABASE_URL,
  ssl:{ 
    rejectUnauthorized: false
  }
});

// app.use(cors(corsOptions));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests from any origin
    // if(origin==="https://e-commerce-ep2l.onrender.com"){
      callback(null, true);
    // }
  }, // Allow requests from this origin
  credentials: true // Allow sending cookies
}));
// Configure session
app.use(cookieParser());
app.use(session({
  store: new pgSession({
    pool: pool, 
    tableName: 'session',
  }),
  secret: "iopjkl1234",
  resave: false,
  saveUninitialized: false,
  cookie:{
    maxAge: 24*60*60*1000,
    // domain:".onrender.com",
    // sameSite:"none",
    // secure: true,
    // httpOnly: true
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());
app.use(bodyParser.json());

// Configure Passport with a local strategy
passport.use(new LocalStrategy(
  async (username, password, done) => {
    const result = await pool.query("Select * from my_users where user_name = $1",[username]);
    if(!result.rows[0]){
      return done(false, {message: "No Valid Username"});
    }
    // String(result.rows[0].password)!==String(password)
    const valid = await bcrypt.compare(password, result.rows[0].password)
    if(!valid){
      return done(false, {message:"Incorrect Password"});
    }
    return done(null, result.rows[0]);
  }
  ));
  
// Serialize user to the session
passport.serializeUser(function(user, done) {
  done(null, user.user_id);
});

// Deserialize user from the session
passport.deserializeUser(async function(id, done) {
  try {
    const result = await pool.query("SELECT * FROM my_users WHERE user_id = $1", [id]);
    
    if (result.rows.length === 0) {
      return done(null, false);
    }
    
    const user = result.rows[0];
    return done(null, user);
  } catch (error) {
    return done(error);
  }
});

// // Routes and other middleware go here
// app.get('/', (req, res)=>{
  //   res.render('Welcome');
  // })
  // app.use(passport.authenticate('session'));

app.post('/login', async (req, res, next) => {
    passport.authenticate('local', { failureRedirect: '/login' }, async (err, user, info) => {
      if (err) {
        return next(err);
      }
      
      if (!user) {
          res.status(404).json({ message: "Authentication error" });
      }

      req.login(user, (loginErr) => {
          if (loginErr) {
              return next(loginErr);
          }
          if (req.isAuthenticated()) {
              return res.json({message:"Authentication done", user: req.user});;
          } else {
              return res.status(200).json({ message: "Authentication failed" });
          }
      })
  })(req, res, next);
});

// app.post('/login', passport.authenticate('local', { failureRedirect: 'http://localhost:3001/login' }), (req, res) => {
//     // If this callback is reached, authentication was successful and the user is logged in
//     res.redirect('http://localhost:3001/');
// });

app.post('/signup', async (req, res, next) => {
  const { username, password , user_id} = req.body;
  const hashed = await bcrypt.hash(password, 10);
  try {
    // Check if the username already exists in the database
    const existingUser = await pool.query('SELECT * FROM my_users WHERE user_name = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    // Insert the new user into the database
    const newUser = await pool.query('INSERT INTO my_users (user_name, password, user_id) VALUES ($1, $2, $3) RETURNING *', [username, hashed, user_id]);

    // Log in the newly registered user
    req.login(newUser.rows[0], function(err) {
      if (err) {
        return next(err);
      }
      return res.status(200).json({ message: 'Registration successful', user: req.user });
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/cart/:id', async (req, res) => {
  if(req.isAuthenticated()){
    const userId = req.params.id;
    const result = await pool.query('SELECT cart.count, cart.user_id, products.product_img, products.product_name, products.product_id, products.price FROM cart JOIN products ON cart.product_id = products.product_id WHERE cart.user_id = $1;', [userId]);

    if (result.rows.length === 0) {
      res.status(200).json([{ message: "Cart is empty" }]);
    } else {
      res.status(200).json(result.rows);
    }
  }else{
    res.status(401).json({message:"Please Login"})
  }
});

app.post('/cart/inc/:id', async (req, res) => {
  try {
    if(req.isAuthenticated()){
      const user_id = req.params.id; 
      const { product_id } = req.body;
      const result = await pool.query('UPDATE cart SET count = count + 1 WHERE user_id = $1 AND product_id = $2', [user_id, product_id]);
      if (result.rowCount === 1) {
          res.status(200).json({ message: 'Value incremented' }); 
      } else {
          res.status(401).json({ message: 'Error occurred' }); 
      }
  }
 }catch (err) {
      console.log(err);
  }
});

app.post('/cart/dec/:id', async (req, res) => {
  try {
    if(req.isAuthenticated()){
      const user_id = req.params.id; 
      const { product_id } = req.body;
      const result = await pool.query('UPDATE cart SET count = count - 1 WHERE user_id = $1 AND product_id = $2', [user_id, product_id]);
      if (result.rowCount === 1) {
        const data = await pool.query('SELECT count FROM cart WHERE user_id = $1 AND product_id = $2', [user_id, product_id]);
        if(data.rows[0].count===0){
          await pool.query('DELETE FROM cart WHERE user_id = $1 AND product_id = $2', [user_id, product_id]);
          res.status(200).json({message:'Item removed'});
        }
          res.status(200).json({ message: 'Value decremented'}); 
      } else {
          res.status(401).json({ message: 'Error occurred' }); 
      }
  }
} catch (err) {
      console.log(err);
  }
});


app.post('/search', async (req, res) => {
  try {
    const { searchterm } = req.body;
    const result = await pool.query('SELECT * FROM products WHERE product_name LIKE $1;', ['%' + searchterm + '%']);
    if (result.rowCount === 0) {
      res.status(404).json({ message: "No items found" , result:result.rows});
    } else {
      res.status(200).json(result.rows);
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Internal server error" });
  }
});


app.get('/category', async(req, res)=>{
  const { category } = req.body;
  const result = await pool.query('Select * from products where category = $1',[category]);
  if(!result.rows[0]){
    res.status(404).send(); 
  }else{
    res.status(200).json(result.rows);
  } 
});

// app.post('/products', async(req, res)=>{
//   const {product_id, product_name, product_img, price, category} = req.body;
//   await pool.query('insert into products values($1,$2,$3,$4,$5)',[product_id, product_name, product_img, price, category]);
//   res.status(200).send("data sent");
// })

app.post('/cart', async (req, res) => {
  if(req.isAuthenticated()){
  const { id, product_id } = req.body;
  try {
      // Check if the item already exists in the cart
      const data = await pool.query('SELECT * FROM cart WHERE user_id = $1 AND product_id = $2', [id, product_id]);
      
      if (data.rowCount === 0) {
          // If the item does not exist, insert it with count 1
          const result = await pool.query('INSERT INTO cart (user_id, product_id, count) VALUES ($1, $2, 1)', [id, product_id]);
          
          if (result.rowCount === 1) {
              res.status(200).json({ message: "Added to cart successfully" });
          } else {
              res.status(401).json({ message: "Failed to add to cart" });
          }
      } else {
          // If the item already exists, update its count
          const count = data.rows[0].count + 1;
          const result = await pool.query('UPDATE cart SET count = $1 WHERE user_id = $2 AND product_id = $3', [count, id, product_id]);

          if (result.rowCount === 1) {
              res.status(200).json({ message: "Added to cart successfully" });
          } else {
              res.status(401).json({ message: "Failed to add to cart" });
          }
      }
  } catch (error) {
      console.error("Error adding to cart:", error);
      res.status(500).json({ message: "Internal server error" });
  }
 }else{
  res.status(401).json({message:"Please Login"})
}
});

app.get('/products', async(req, res)=>{
  try{
    const result = await pool.query('SELECT * FROM products');
    if(result.rows[0]){
      res.status(200).json(result.rows);
      return;
    }
    else{
      res.status(400).json({message:"Could not retrieve products"});
      return;
    }
  }catch(err){
    console.log(err);
  }
})

app.post('/logout', function(req, res, next){
  req.logout(function(err) {
    if (err) { return next(err); }
    res.status(200).json({message:"logged Out"});
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
