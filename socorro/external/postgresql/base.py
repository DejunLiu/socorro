# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import contextlib
import logging

from configman import Namespace, RequiredConfig
from configman.converters import class_converter
import psycopg2

from socorro.external.postgresql.dbapi2_util import (
    execute_query_fetchall,
    single_value_sql
)
from socorro.lib import DatabaseError


logger = logging.getLogger("webapi")


class PostgreSQLStorage(RequiredConfig):
    """Storage class for Postgres-using models

    This gives us a transaction_executor_class and a database_class which we
    need for tests.

    """
    required_config = Namespace()

    required_config.add_option(
        'transaction_executor_class',
        default='socorro.lib.transaction.TransactionExecutorWithInfiniteBackoff',
        doc='a class that will manage transactions',
        from_string_converter=class_converter,
        reference_value_from='resource.postgresql',
    )
    required_config.add_option(
        'database_class',
        default='socorro.external.postgresql.connection_context.ConnectionContext',
        doc='the class responsible for connecting to Postgres',
        from_string_converter=class_converter,
        reference_value_from='resource.postgresql',
    )


class PostgreSQLBase(object):

    """
    Base class for PostgreSQL based service implementations.
    """

    def __init__(self, *args, **kwargs):
        """
        Store the config and create a connection to the database.

        Keyword arguments:
        config -- Configuration of the application.

        """
        self.context = kwargs.get("config")
        try:
            self.database = self.context.database_class(
                self.context
            )
        except KeyError:
            # some tests seem to put the database config parameters
            # into a namespace called 'database', others do not
            self.database = self.context.database.database_class(
                self.context.database
            )

    @contextlib.contextmanager
    def get_connection(self):
        connection = self.database.connection()
        try:
            yield connection
        finally:
            connection.close()

    def query(self, sql, params=None, error_message=None, connection=None):
        """Return the result of a query executed against PostgreSQL.

        Create a connection, open a cursor, execute the query and return the
        results. If an error occures, log it and raise a DatabaseError.

        Keyword arguments:
        sql -- SQL query to execute.
        params -- Parameters to merge into the SQL query when executed.
        error_message -- Eventual error message to log.
        connection -- Optional connection to the database. If none, a new one
                      will be opened.

        """
        return self._execute(
            execute_query_fetchall,
            sql,
            error_message or "Failed to execute query against PostgreSQL",
            params=params,
            connection=connection
        )

    def count(self, sql, params=None, error_message=None, connection=None):
        """Return the result of a count SQL query executed against PostgreSQL.

        Create a connection, open a cursor, execute the query and return the
        result. If an error occures, log it and raise a DatabaseError.

        Keyword arguments:
        sql -- SQL query to execute.
        params -- Parameters to merge into the SQL query when executed.
        error_message -- Eventual error message to log.
        connection -- Optional connection to the database. If none, a new one
                      will be opened.

        """
        return self._execute(
            single_value_sql,
            sql,
            error_message or "Failed to execute count against PostgreSQL",
            params=params,
            connection=connection
        )

    @contextlib.contextmanager
    def cursor(self, sql, params=None, error_message=None, connection=None):
        fresh_connection = not connection
        if not connection:
            connection = self.database.connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                yield cursor
        finally:
            if connection and fresh_connection:
                connection.close()

    def _execute(
        self, actor_function, sql, error_message, params=None, connection=None
    ):
        fresh_connection = False
        try:
            if not connection:
                connection = self.database.connection()
                fresh_connection = True
            # logger.debug(connection.cursor().mogrify(sql, params))
            result = actor_function(connection, sql, params)
            connection.commit()
        except psycopg2.Error as e:
            error_message = "%s - %s" % (error_message, str(e))
            logger.error(error_message, exc_info=True)
            if connection:
                connection.rollback()
            raise DatabaseError(error_message)
        finally:
            if connection and fresh_connection:
                connection.close()
        return result
