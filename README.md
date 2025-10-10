# Radiology Core Exam Study Planner

This is an interactive, day-by-day study planner for radiology residents preparing for their Core Exam. It uses a powerful backend solver to generate an optimized schedule based on your resources and constraints.

## Architecture Overview

This project has two main parts:
1.  **Frontend (This Repo):** A React application built with Vite and deployed on Vercel.
2.  **Backend Solver:** A Python/Flask service using Google OR-Tools, designed to be deployed as a container on a service like Google Cloud Run.

The flow is as follows: The user requests a schedule generation/rebalance from the frontend. The frontend calls a Vercel API route, which creates a "run" job in a Supabase database and triggers the backend solver. The solver fetches data from Supabase, calculates the optimal schedule, and writes the results back to the database. The frontend polls the database for the results and displays them when ready.

## Setup & Deployment Guide

### Step 1: Set Up Supabase

Your Supabase project is the central hub for all data.

1.  **Create Tables:** Go to your Supabase project's "SQL Editor". Create a new query, paste the entire content of `sql/schema.sql`, and run it. This will create the `resources`, `runs`, and `schedule_slots` tables.
2.  **Seed Data:** Create another new query. Paste the entire content of `sql/seed.sql` and run it. This populates your `resources` table with the complete master list of study materials.

### Step 2: Deploy the Backend Python Solver

The solver service needs to be deployed separately. We recommend Google Cloud Run for its scalability and free tier.

**1. Set Up Your Local Python Project**
On your computer (in a separate folder from this React app), create a new folder named `radiology-solver`. Inside it, create three files and paste the content from this project into them:
- `main.py`
- `requirements.txt`
- `Dockerfile`

**2. Install Google Cloud CLI & Configure**
- If you don't have it, [install the gcloud command-line tool](https://cloud.google.com/sdk/docs/install).
- Login and set your project:
  ```bash
  gcloud auth login
  gcloud config set project [YOUR_PROJECT_ID]
  ```
- Enable the necessary APIs:
  ```bash
  gcloud services enable run.googleapis.com
  gcloud services enable artifactregistry.googleapis.com
  ```

**3. Deploy to Cloud Run**
- In your terminal, navigate into your `radiology-solver` folder.
- Run the deploy command:
  ```bash
  gcloud run deploy radiology-solver --source . --region us-central1 --allow-unauthenticated
  ```
- This will take a few minutes. When it's done, it will print a **Service URL**. Copy this URL.

### Step 3: Configure Environment Variables

This is the final step to connect everything.

**1. Generate a Secret Token**
Create a long, random string to act as a password between your Vercel app and your Cloud Run service. Example: `my-super-secret-solver-token-12345`.

**2. Configure Cloud Run Environment Variables**
- Go to the Google Cloud Run console and find your `radiology-solver` service.
- Click "Edit & Deploy New Revision".
- Go to the "Variables & Secrets" tab and add these three environment variables:
  - `SUPABASE_URL`: Your Supabase project URL.
  - `SUPABASE_KEY`: Your Supabase **service_role key** (find in Supabase Settings > API).
  - `INTERNAL_API_TOKEN`: The secret token you just generated.
- Click "Deploy".

**3. Configure Vercel Environment Variables**
- Go to your Vercel project dashboard > Settings > Environment Variables.
- Add the following variables:
  - `VITE_SUPABASE_URL`: Your Supabase project URL.
  - `VITE_SUPABASE_ANON_KEY`: Your Supabase **anon key** (find in Supabase Settings > API).
  - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase **service_role key**.
  - `SOLVER_URL`: The **Service URL** you copied from your Cloud Run deployment.
  - `SOLVER_TOKEN`: The same secret token you used for `INTERNAL_API_TOKEN` in Cloud Run.
- **Redeploy Vercel:** Trigger a new deployment in Vercel to apply the new environment variables.

Your application is now fully configured and ready to use!