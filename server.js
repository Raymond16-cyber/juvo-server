import app from "./app.js";
import connectDb from "./config/db.js";


const port = process.env.PORT || 5000;
async function startServer() {
  try {
    await connectDb();

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

void startServer();
