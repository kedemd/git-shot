# git-shot
Take screenshots of github commits

This app allows a user to add repositories, then those repositories are monitored for commits.
Every commit has a screenshot taken by a side worker. (implemented as an async set timeout loop :).

It uses an authentication token from github.

This app is not secure, so don't use a sensitive token.

[Demo](http://ec2-54-144-222-70.compute-1.amazonaws.com/)


##How to run:
```
npm install
node server
```

##Prerequisites:
database table name vatit. Tables are created automatically.
###Run the following in mysql:
``
Create Table vatit;
``

## The server
Uses Hapijs for API server and a mysql database.

## Limitations
The current database user is hardcoded as root. 
This is not for production purposes. 
Make sure you restrict access to the database to a localhost only.

## What is this 'OK' client library
It is a lightweight client side library I wrote. I am using it here to test its viability.
It is a replacement for other libraries such as react / angular / vue.

I think that it is easier to learn and create quick webpages that don't require a build step. excellent for prototyping.

And it has the most elegant and easy to understand syntax.

It is based on proxies for change detection and binding.

## Pageres

This library is using pageres for taking screenshots of pages. Under the hood it uses puppeteer and chrumium.

## Other Notes

This is not for production. It was written in a couple of hours and was not thoroughly tested.

    
