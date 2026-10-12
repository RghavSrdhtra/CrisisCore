#!/bin/bash

echo "==================================================="
echo "Welcome to CrisisCore - Rapid Crisis Response Platform"
echo "==================================================="
echo ""

echo "Installing required dependencies..."
npm install

echo ""
echo "Starting the CrisisCore development server..."
echo "Once started, open your browser and navigate to the Local URL provided below (usually http://localhost:5173/)"
echo ""
npm run dev
