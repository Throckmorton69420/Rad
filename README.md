# Radiology Study Planner

This is an interactive, day-by-day study planner for radiology residents preparing for their Core Exam. It uses a sophisticated CP-SAT solver running on Google Cloud Run to generate an optimal schedule based on a comprehensive list of study resources.

## Architecture

This project uses a modern serverless architecture designed for robust, asynchronous background processing:

-   **Frontend**: Vite + React + TypeScript, deployed on Vercel.
-   **Backend Solver**: Python (Flask + Google OR-Tools), containerized and deployed on Google Cloud Run.
-   **Database**: Supabase (PostgreSQL) for storing resources, solver jobs, and user data.
-   **Task Queue**: Google Cloud Tasks for reliably triggering long-running solver jobs asynchronously.
-   **API Layer**: Vercel Serverless Functions act as a bridge between the frontend and the backend task queue.

## Setup Instructions

### 1. Supabase Setup

1.  Create a new project on [Supabase](https://supabase.com/).
2.  Navigate to the **SQL Editor**.
3.  Copy the entire contents of `sql/schema.sql` and run it to create the necessary tables (`resources`, `runs`, `schedule_slots`, `user_data`).
4.  Copy the entire contents of `sql/seed.sql` and run it to populate the `resources` table with the master list of study materials.
5.  Go to **Project Settings** > **API**.
    -   Find your **Project URL**.
    -   Find your **Project API Keys**. You will need the `anon` (public) key and the `service_role` (secret) key.

### 2. Google Cloud Setup

This is a one-time setup for the project's backend infrastructure.

#### Part A: Enable APIs

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Ensure you are in the correct project (`scheduler-474709`).
3.  In the **search bar** at the top, find and **Enable** the following APIs if they are not already enabled:
    -   **Cloud Run API**
    -   **Cloud Build API**
    -   **Cloud Tasks API**

#### Part B: Create a Task Queue

1.  In the console search bar, type `Cloud Tasks` and navigate to the Cloud Tasks page.
2.  Click **"Create Queue"**.
3.  Set the **Queue name** to `solver-queue`.
4.  Set the **Region** to `us-central1` (to match your Cloud Run service).
5.  Leave the other settings as default and click **"Create"**.
    *(Note: The default "Push" queue type is correct for this application, which will be used to send HTTP tasks to your solver service.)*

#### Part C: Create a Dedicated Service Account for Vercel

This service account provides secure credentials for your Vercel functions to create tasks without exposing a master key.

1.  In the console search bar, type `IAM & Admin` and navigate to **Service Accounts**.
2.  Click **"+ CREATE SERVICE ACCOUNT"**.
3.  **Service account name:** Enter `vercel-task-creator`.
4.  Click **"CREATE AND CONTINUE"**.
5.  In the **"Select a role"** dropdown, grant the following two roles:
    -   `Cloud Tasks Enqueuer` (allows it to add tasks to the queue).
    -   `Cloud Run Invoker` (allows it to trigger your private Cloud Run service).
6.  Click **"CONTINUE"**, then click **"DONE"**.

#### Part D: Generate a JSON Key for the Service Account

1.  From the Service Accounts list, click on the email of the `vercel-task-creator` account you just made.
2.  Go to the **"KEYS"** tab.
3.  Click **"ADD KEY"** -> **"Create new key"**.
4.  Select **JSON** as the key type and click **"CREATE"**.
5.  A JSON file will download. **Treat this file as a password and never commit it to git.**

### 3. Vercel Environment Variables Setup

In your Vercel project dashboard, go to **Settings > Environment Variables**. Add the following variables:

| Variable Name                 | Value                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`           | Your Supabase Project URL.                                                                            |
| `VITE_SUPABASE_ANON_KEY`      | Your Supabase `anon` (public) key.                                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`   | Your Supabase `service_role` (secret) key.                                                            |
| `GCP_PROJECT_ID`              | `scheduler-474709`                                                                                    |
| `GCP_QUEUE_LOCATION`          | `us-central1`                                                                                         |
| `GCP_QUEUE_NAME`              | `solver-queue`                                                                                        |
| `SOLVER_URL`                  | The URL of your deployed Google Cloud Run service (from the next step).                               |
| `INTERNAL_API_TOKEN`          | A long, random, secret string you create. Used for an extra layer of security.                        |
| `GCP_CLIENT_EMAIL`            | The `client_email` from the downloaded JSON key file.                                                 |
| `GCP_PRIVATE_KEY`             | The entire `private_key` from the JSON key file, including the `-----BEGIN...` and `-----END...` lines. |

### 4. Backend Deployment to Google Cloud Run

1.  Ensure you have the `gcloud` CLI installed and authenticated (`gcloud auth login`).
2.  From your project's root directory, run the deployment command:

    ```bash
    gcloud run deploy radiology-solver \
      --source . \
      --platform managed \
      --region us-central1 \
      --service-account="Default compute service account" \
      --set-env-vars="SUPABASE_URL=YOUR_SUPABASE_URL" \
      --set-env-vars="SUPABASE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY" \
      --set-env-vars="INTERNAL_API_TOKEN=YOUR_SECRET_TOKEN" \
      --timeout=900 \
      --cpu=1 \
      --memory=2Gi \
      --min-instances=1 \
      --ingress=all
    ```
    -   Replace `YOUR_SUPABASE_URL`, `YOUR_SUPABASE_SERVICE_ROLE_KEY`, and `YOUR_SECRET_TOKEN` with the actual values from your Supabase and Vercel settings.
    -   **Note on `--ingress=all`**: This flag allows your service to receive requests from the internet. This is required because the Vercel functions that trigger the solver run outside of your Google Cloud project's private network. The service remains secure because it is still protected by IAM and requires an authenticated request from a service account with the "Cloud Run Invoker" role.

3.  After deployment, copy the **Service URL** provided by Cloud Run and paste it into the `SOLVER_URL` environment variable in Vercel.

### 5. Frontend Deployment to Vercel

-   With all environment variables configured, push your code to the main branch linked to your Vercel project. Vercel will automatically build and deploy the frontend and serverless functions.
-   You may need to manually trigger a new deployment in the Vercel dashboard to ensure it uses the latest environment variables.
